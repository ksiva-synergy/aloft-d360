import { handle, ok } from '@/lib/http';
import { deleteKnowledgeBase, getKnowledgeBase, updateKnowledgeBase } from '@/lib/knowledge/service';
import { knowledgeActor, pageContext } from '../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** One knowledge base, with `pageContext` for the page. */
export const GET = handle<Ctx>(async (req, ctx) => {
  const actor = await knowledgeActor(req);
  return ok({ knowledgeBase: await getKnowledgeBase(actor, (await ctx.params).id), ...pageContext(actor) });
});

/** `{ name?, description?, archived?, scope? }` — scope changes are for admins. Archiving hides it and stops search; nothing is deleted. */
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return ok({ knowledgeBase: await updateKnowledgeBase(await knowledgeActor(req), (await ctx.params).id, body) });
});

/** Deletes an archived knowledge base with all its documents and files. */
export const DELETE = handle<Ctx>(async (req, ctx) => ok({ deleted: await deleteKnowledgeBase(await knowledgeActor(req), (await ctx.params).id) }));
