import { ApiError, handle, ok } from '@/lib/http';
import { listDocuments, maxUploadBytes, uploadDocument } from '@/lib/knowledge/service';
import { knowledgeActor } from '../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Current documents with their indexing status (queued, indexing, indexed, failed), pages and pieces. */
export const GET = handle<Ctx>(async (req, ctx) => ok({ documents: await listDocuments(await knowledgeActor(req), (await ctx.params).id) }));

/**
 * Upload one file (multipart field `file`, and `folder` with its folder when a whole folder is
 * dropped). The page sends several files one request at a time so each gets its own progress and
 * result. Answers 201 when queued for indexing, 200 when the same
 * file is already there unchanged.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const actor = await knowledgeActor(req);
  const declared = Number(req.headers.get('content-length') ?? 0);
  // Refuse an oversized body before reading it (with room for the multipart envelope).
  if (declared > maxUploadBytes() + 64 * 1024) throw new ApiError(413, `The file is larger than the ${maxUploadBytes() / 1048576} MB limit`);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new ApiError(400, 'Send the file as multipart form field "file"');
  const result = await uploadDocument(actor, (await ctx.params).id, {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    folder: form?.get('folder') ?? undefined,
  });
  return ok(result, result.outcome === 'queued' ? 201 : 200);
});
