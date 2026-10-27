import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/http';
import { readConnectionFile, type Actor } from '@/lib/connections/service';
import { extractionSchemaNames, getExtractionSchema } from './schemas';
import { renderDocument, UnsupportedDocumentError } from './render';
import { ExtractionUnavailableError, extractFields, grokVision, type ExtractionResult, type VisionCall } from './extract';

// Live `document.extract`: download one file through a connection the caller may use, render its
// pages, and read the schema's fields with Grok in one call. Used by "Try on a file" today and by
// the run engine's document.extract handler later. The audit records what was read, never values.

export const maxExtractionPages = () => intEnv('EXTRACTION_MAX_PAGES', 10, 1, 20);
export const maxExtractionBytes = () => intEnv('EXTRACTION_MAX_MB', 20, 1, 50) * 1048576;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export type DocumentExtraction = ExtractionResult & {
  file: { connectionId: string; path: string; name: string };
  pages: { sent: number; total: number; truncated: boolean };
};

export async function extractFromConnection(
  actor: Actor,
  input: { connectionId: string; path: string; schema: string },
  vision?: VisionCall,
): Promise<DocumentExtraction> {
  const schema = getExtractionSchema(input.schema);
  if (!schema) throw new ApiError(422, `Unknown extraction schema "${input.schema}". Available: ${extractionSchemaNames().join(', ')}`);
  let call: VisionCall;
  try {
    call = vision ?? grokVision();
  } catch (e) {
    if (e instanceof ExtractionUnavailableError) throw new ApiError(503, e.message, { code: 'extraction_unavailable' });
    throw e;
  }

  const file = await readConnectionFile(actor, input.connectionId, input.path, maxExtractionBytes());
  let rendered;
  try {
    rendered = await renderDocument(file.bytes, { maxPages: maxExtractionPages() });
  } catch (e) {
    if (e instanceof UnsupportedDocumentError) throw new ApiError(422, `${file.name}: ${e.message}`);
    throw e;
  }

  let result: ExtractionResult;
  try {
    result = await extractFields({ schema, images: rendered.images, fileName: file.name, pageCount: rendered.pageCount, truncated: rendered.truncated }, call);
  } catch (e) {
    console.error('[extraction] model call failed:', e instanceof Error ? e.message.slice(0, 300) : e);
    throw new ApiError(502, `The model could not read ${file.name}: ${e instanceof Error ? e.message.slice(0, 300) : 'unknown error'}`, { code: 'extraction_failed' });
  }

  const pages = { sent: rendered.images.length, total: rendered.pageCount, truncated: rendered.truncated };
  await writeAudit({
    actorId: actor.userId,
    action: 'document.extracted',
    entityType: 'connection',
    entityId: file.connection.id,
    // What was read and by which model; never the extracted values or the document itself.
    after: { path: input.path, schema: schema.name, pages, missing: result.missing.length, model: result.model, usage: result.usage },
  });
  return { ...result, file: { connectionId: file.connection.id, path: input.path, name: file.name }, pages };
}
