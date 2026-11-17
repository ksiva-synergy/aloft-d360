import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { decideApproval } from '@/lib/flows-store/runs';
import { estimateAgentCostUsd, flowsRequestContext } from '../../../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string; runId: string }> };

const body = z.object({
  stepId: z.string().min(1).max(60),
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(1000).optional(),
});

/** Approves or rejects a paused approval step. Approving resumes the run and returns where it stopped next. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { actor, policy } = await flowsRequestContext(req);
  const input = parse(body, await req.json().catch(() => ({})));
  const { id, runId } = await ctx.params;
  return ok({ run: await decideApproval(actor, policy, id, runId, { ...input, estimateAgentCostUsd }) });
});
