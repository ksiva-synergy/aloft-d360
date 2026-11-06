import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { searchForUser } from '@/lib/knowledge/service';
import { knowledgeActor } from '../_shared';

export const dynamic = 'force-dynamic';

const body = z.object({
  question: z.string().trim().min(2).max(2000),
  knowledgeBaseIds: z.array(z.string().uuid()).max(50).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

/** Search the knowledge bases this person can see (or the ones named), with citations. */
export const POST = handle(async (req) => {
  const actor = await knowledgeActor(req);
  const input = parse(body, await req.json().catch(() => ({})));
  return ok({ results: await searchForUser(actor, { ...input, surface: 'test_search' }) });
});
