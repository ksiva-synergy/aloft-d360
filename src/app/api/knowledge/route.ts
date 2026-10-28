import { handle, ok } from '@/lib/http';
import { createKnowledgeBase, listKnowledgeBases } from '@/lib/knowledge/service';
import { knowledgeActor, pageContext } from './_shared';

export const dynamic = 'force-dynamic';

/** Knowledge bases this person can see (their personal ones and the organisation's), with `pageContext`. */
export const GET = handle(async (req) => {
  const actor = await knowledgeActor(req);
  return ok({ knowledgeBases: await listKnowledgeBases(actor), ...pageContext(actor) });
});

/** `{ name, description?, scope?: "personal" | "org" }`. Organisation knowledge bases are created by admins. */
export const POST = handle(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return ok({ knowledgeBase: await createKnowledgeBase(await knowledgeActor(req), { name: body.name, description: body.description, scope: body.scope }) }, 201);
});
