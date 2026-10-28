import { UnreadableDocumentError, type DocBlock } from './blocks';
import { OcrUnavailableError, type OcrConfig } from './ocr';
import { readDocument, type ReadOutcome } from './readers';
import { splitBlocks } from './split';
import type { ChunkToStore, KnowledgeDocumentRow, KnowledgeRepo } from './repo';

// Indexes one knowledge document: read it (by type, with OCR for scanned pages), split it by
// structure, embed with Titan only the pieces whose content is new to this knowledge base, then
// replace the document's chunks in one transaction. A document that cannot be read is marked failed
// with the reason; a temporary problem (Titan or OCR unavailable, network) is thrown as retryable so
// the job runs again later.

export type IndexDeps = {
  repo: KnowledgeRepo;
  readBytes: (storageRef: string) => Promise<Uint8Array>;
  embed: (texts: string[]) => Promise<number[][]>;
  ocr: OcrConfig | null;
  fetchImpl?: typeof fetch;
};

export class RetryableIndexError extends Error {
  readonly retryable = true;
}

export type IndexReport = { documentId: string; status: 'indexed' | 'failed'; chunks: number; embedded: number; reused: number; pages: number | null; ocrPages: number; failedPages: number[]; warnings: string[]; error?: string };

async function read(doc: KnowledgeDocumentRow, deps: IndexDeps): Promise<ReadOutcome> {
  if (doc.kind === 'qa') {
    const blocks: DocBlock[] = [{ kind: 'qa', question: doc.question ?? '', answer: doc.answer ?? '' }];
    return { kind: 'text', blocks, ocrPages: 0, failedPages: [], warnings: [] };
  }
  if (!doc.storage_ref) throw new UnreadableDocumentError('The original file is not stored, so it cannot be read');
  const bytes = await deps.readBytes(doc.storage_ref);
  return readDocument(bytes, doc.name, { ocr: deps.ocr, fetchImpl: deps.fetchImpl });
}

export async function indexDocument(documentId: string, deps: IndexDeps): Promise<IndexReport> {
  const doc = await deps.repo.getDocument(documentId);
  if (!doc) throw new Error(`Knowledge document ${documentId} not found`);
  if (doc.status === 'superseded') {
    return { documentId, status: 'indexed', chunks: 0, embedded: 0, reused: 0, pages: null, ocrPages: 0, failedPages: [], warnings: ['A newer version exists; skipped'] };
  }
  await deps.repo.setDocumentStatus(doc.id, 'indexing');

  let outcome: ReadOutcome;
  try {
    outcome = await read(doc, deps);
  } catch (e) {
    // Permanent: the file itself is the problem, or OCR is not set up. Recorded, not retried.
    if (e instanceof UnreadableDocumentError || e instanceof OcrUnavailableError) {
      await deps.repo.saveFailed(doc, e.message);
      return { documentId, status: 'failed', chunks: 0, embedded: 0, reused: 0, pages: null, ocrPages: 0, failedPages: [], warnings: [], error: e.message };
    }
    throw new RetryableIndexError(e instanceof Error ? e.message : String(e));
  }

  const chunks = splitBlocks(outcome.blocks, { docName: doc.name });
  const known = await deps.repo.embeddingsByHash(doc.source_id, [...new Set(chunks.map((c) => c.contentHash))]);
  // New content only, once per distinct piece (a repeated page header is embedded once).
  const todo = [...new Map(chunks.filter((c) => !known.has(c.contentHash)).map((c) => [c.contentHash, c])).values()];
  const fresh = await deps.embed(todo.map((c) => c.embedText)); // throws a retryable error if Titan is down
  todo.forEach((c, i) => known.set(c.contentHash, fresh[i]!));
  const toStore: ChunkToStore[] = chunks.map((c) => ({ ...c, embedding: known.get(c.contentHash)! }));

  const warnings = outcome.warnings;
  await deps.repo.saveIndexed(doc, toStore, {
    status: 'indexed',
    chunkCount: toStore.length,
    pageCount: outcome.pageCount ?? null,
    ocrPages: outcome.ocrPages,
    failedPages: outcome.failedPages,
    error: warnings.length ? warnings.join('; ').slice(0, 2000) : null,
  });
  return {
    documentId,
    status: 'indexed',
    chunks: toStore.length,
    embedded: todo.length,
    reused: chunks.length - todo.length,
    pages: outcome.pageCount ?? null,
    ocrPages: outcome.ocrPages,
    failedPages: outcome.failedPages,
    warnings,
  };
}
