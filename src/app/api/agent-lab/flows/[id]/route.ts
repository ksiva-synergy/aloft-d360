import { handle, noContent, ok } from '@/lib/http';
import { deleteFlow, getFlow } from '@/lib/flows-store/service';
import { flowsRequestContext } from '../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const { actor } = await flowsRequestContext(req);
  return ok({ flow: await getFlow(actor, (await ctx.params).id) });
});

export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { actor } = await flowsRequestContext(req);
  await deleteFlow(actor, (await ctx.params).id);
  return noContent();
});
