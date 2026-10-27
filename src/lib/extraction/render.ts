import { createCanvas } from '@napi-rs/canvas';

// Turns a downloaded document into page images for a vision model: PDF pages are rendered to PNG
// (pdf.js + @napi-rs/canvas, no system binaries); PNG and JPEG files are passed through. The file
// type is decided from the bytes, never from the name or the storage's content type.

export type PageImage = { page: number; mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array };
export type RenderedDocument = { kind: 'pdf' | 'png' | 'jpeg'; images: PageImage[]; pageCount: number; truncated: boolean };

export type RenderOptions = {
  /** Pages sent at most; later pages are dropped and `truncated` is set. */
  maxPages: number;
  /** Rendering resolution. 150 dpi keeps print legible at about 1.5k tokens a page. */
  dpi?: number;
  /** Longest side in pixels, so a poster-sized page does not become a huge image. */
  maxSidePx?: number;
};

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDocumentError';
  }
}

export function sniffDocument(bytes: Uint8Array): RenderedDocument['kind'] | null {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  if (String.fromCharCode(...head(5)) === '%PDF-') return 'pdf';
  if (head(8).join() === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].join()) return 'png';
  if (head(3).join() === [0xff, 0xd8, 0xff].join()) return 'jpeg';
  return null;
}

export async function renderDocument(bytes: Uint8Array, opts: RenderOptions): Promise<RenderedDocument> {
  const kind = sniffDocument(bytes);
  if (kind === 'png' || kind === 'jpeg') {
    return { kind, images: [{ page: 1, mime: kind === 'png' ? 'image/png' : 'image/jpeg', bytes }], pageCount: 1, truncated: false };
  }
  if (kind !== 'pdf') throw new UnsupportedDocumentError('Only PDF, PNG and JPEG files can be read');

  // Legacy build: the Node-compatible one. Loaded lazily so routes that never render do not pay for it.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({
      // pdf.js may detach the buffer it is given; keep the caller's bytes intact.
      data: new Uint8Array(bytes),
      // No code generation from document content, no font loading from the system or the network.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    throw new UnsupportedDocumentError(name === 'PasswordException' ? 'The PDF is password-protected' : 'The PDF could not be opened');
  }
  try {
    const dpi = opts.dpi ?? 150;
    const maxSide = opts.maxSidePx ?? 2000;
    const count = Math.min(doc.numPages, opts.maxPages);
    const images: PageImage[] = [];
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(dpi / 72, maxSide / Math.max(unscaled.width, unscaled.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js types expect DOM canvas objects; @napi-rs/canvas implements the same 2D API.
      await page.render({ canvasContext: ctx as never, canvas: canvas as never, viewport }).promise;
      images.push({ page: n, mime: 'image/png', bytes: canvas.toBuffer('image/png') });
      page.cleanup();
    }
    return { kind: 'pdf', images, pageCount: doc.numPages, truncated: doc.numPages > count };
  } finally {
    await doc.destroy();
  }
}
