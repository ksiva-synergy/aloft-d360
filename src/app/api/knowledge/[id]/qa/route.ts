import { handle, ok } from '@/lib/http';
import { saveQa } from '@/lib/knowledge/service';
import { knowledgeActor } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Add a Q&A entry written in the app: `{ question, answer }`. */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return ok(await saveQa(await knowledgeActor(req), (await ctx.params).id, { question: body.question, answer: body.answer }), 201);
});
