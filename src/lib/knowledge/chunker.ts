// pdf-parse is not in package.json — PDF extraction is unavailable at MVP scope.
export const PDF_EXTRACTION_AVAILABLE = false;

export interface Chunk {
  content:     string;
  chunk_index: number;
  doc_ref:     string;
  metadata:    { charStart: number; charEnd: number };
}

// ~512 tokens = 2048 chars; overlap = ~50 tokens = 200 chars
const CHUNK_CHARS   = 512 * 4;  // 2048
const OVERLAP_CHARS = 50  * 4;  //  200

/**
 * Split text into overlapping chunks of approximately CHUNK_CHARS characters.
 * Adjacent chunks share OVERLAP_CHARS of content to preserve context at boundaries.
 */
export function chunkText(text: string, docRef: string): Chunk[] {
  const chunks: Chunk[] = [];
  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    const end     = Math.min(pos + CHUNK_CHARS, text.length);
    const content = text.slice(pos, end).trim();

    if (content.length > 0) {
      chunks.push({
        content,
        chunk_index: index++,
        doc_ref: docRef,
        metadata: { charStart: pos, charEnd: end },
      });
    }

    if (end === text.length) break;
    pos = end - OVERLAP_CHARS;
    if (pos <= 0) break;
  }

  return chunks;
}

/**
 * Extract plain text from a file.
 * Supports: .txt, .md, .csv (UTF-8 decode).
 * PDF: not supported at MVP — returns a placeholder string
 *      and the response payload will include pdfExtractionAvailable: false.
 */
export async function extractText(
  file: File | Buffer,
  filename: string,
): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'pdf') {
    return `[PDF text extraction unavailable — install pdf-parse]\n\nFile: ${filename}`;
  }

  const buf =
    file instanceof Buffer
      ? file
      : Buffer.from(await (file as File).arrayBuffer());

  return buf.toString('utf-8');
}
