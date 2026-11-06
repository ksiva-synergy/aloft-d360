import { NextResponse } from 'next/server';
import { handle, ok } from '@/lib/http';
import { deleteDocument, downloadDocument, retryDocument, saveQa } from '@/lib/knowledge/service';
import { knowledgeActor } from '../../../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** The original file, for anyone who can see the knowledge base. */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { id, docId } = await ctx.params;
  const file = await downloadDocument(await knowledgeActor(req), id, docId);
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** `{ retry: true }` queues a failed document again; `{ question, answer }` edits a Q&A entry (new version). */
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id, docId } = await ctx.params;
  const actor = await knowledgeActor(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.retry) {
    await retryDocument(actor, id, docId);
    return ok({ retried: true });
  }
  return ok(await saveQa(actor, id, { question: body.question, answer: body.answer }, docId));
});

/** Removes the document, every version of it, its pieces and its stored files. */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id, docId } = await ctx.params;
  return ok({ deleted: await deleteDocument(await knowledgeActor(req), id, docId) });
});
