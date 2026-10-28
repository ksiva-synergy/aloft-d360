// The common shape every reader produces. Readers keep where text came from (page, sheet and row,
// slide); the splitter (split.ts) turns blocks into searchable chunks without crossing those units.

export type DocBlock =
  | { kind: 'heading'; level: number; text: string; page?: number }
  | { kind: 'text'; text: string; page?: number }
  /** One spreadsheet or document-table row, as header → value pairs. */
  | { kind: 'row'; cells: [string, string][]; table?: string; row?: number; page?: number }
  | { kind: 'slide'; slide: number; text: string }
  | { kind: 'qa'; question: string; answer: string }
  | { kind: 'image'; text: string };

export type ReadResult = {
  blocks: DocBlock[];
  /** Pages (PDF), sheets (spreadsheet) or slides (presentation), when meaningful. */
  pageCount?: number;
  /** Pages that went through OCR. */
  ocrPages: number;
  /** 1-based pages that could not be read (OCR failed); the rest of the document is still indexed. */
  failedPages: number[];
};

export class UnreadableDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableDocumentError';
  }
}
