import { handle, ok } from '@/lib/http';
import { getRun } from '@/lib/flows-store/runs';
import { flowsRequestContext } from '../../../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; runId: string }> };

/** One run with every step's status, output and error. */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { actor } = await flowsRequestContext(req);
  const { id, runId } = await ctx.params;
  return ok({ run: await getRun(actor, id, runId) });
});
