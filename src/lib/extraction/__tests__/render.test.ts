/**
 * Page rendering: a real PDF (built in memory) is rendered to PNG pages with pdf.js, the page cap
 * holds, images pass through, and anything else is refused by its bytes, not its name.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { renderDocument, sniffDocument, UnsupportedDocumentError } from '../render';
import { makePdf } from './pdf-fixture';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe('renderDocument', () => {
  it('renders each PDF page to a PNG, up to the page cap', { timeout: 30_000 }, async () => {
    const r = await renderDocument(makePdf(['Certificate of Competency', 'Page two', 'Page three']), { maxPages: 2, dpi: 72 });
    expect(r).toMatchObject({ kind: 'pdf', pageCount: 3, truncated: true });
    expect(r.images.map((i) => i.page)).toEqual([1, 2]);
    for (const img of r.images) {
      expect(img.mime).toBe('image/png');
      expect(Array.from(img.bytes.subarray(0, 4))).toEqual(PNG_SIGNATURE);
    }
    // Something was drawn: a blank white 612x792 page compresses to far less than one with text.
    const blank = createCanvas(612, 792);
    const ctx = blank.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 612, 792);
    expect(r.images[0]!.bytes.byteLength).toBeGreaterThan(blank.toBuffer('image/png').byteLength);
  });

  it('caps the longest side', { timeout: 30_000 }, async () => {
    const r = await renderDocument(makePdf(['x']), { maxPages: 1, dpi: 600, maxSidePx: 500 });
    const png = r.images[0]!.bytes;
    const height = new DataView(png.buffer, png.byteOffset).getUint32(20);
    expect(height).toBe(500);
  });

  it('passes PNG and JPEG through and refuses other files by content', async () => {
    const png = createCanvas(10, 10).toBuffer('image/png');
    expect((await renderDocument(png, { maxPages: 5 })).images[0]).toMatchObject({ mime: 'image/png', page: 1 });
    expect(sniffDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    await expect(renderDocument(new TextEncoder().encode('PK\u0003\u0004 a docx'), { maxPages: 1 })).rejects.toBeInstanceOf(UnsupportedDocumentError);
    await expect(renderDocument(new TextEncoder().encode('%PDF-1.4 garbage'), { maxPages: 1 })).rejects.toThrow(/could not be opened/);
  });
});
