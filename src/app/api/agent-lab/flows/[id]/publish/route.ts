import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { publishFlow, unpublishFlow } from '@/lib/flows-store/service';
import { assertFlowsEnabled, estimateAgentCostUsd, flowsRequestContext } from '../../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  version: z.number().int().min(1),
  inputs: z.record(z.unknown()).optional(),
  fixtures: z.record(z.unknown()).optional(),
});

/** Publishes the latest version after the server re-checks policy and re-runs the simulation. */
export const POST = handle<Ctx>(async (req, ctx) => {
  assertFlowsEnabled();
  const { actor, policy } = await flowsRequestContext(req);
  const opts = parse(body, await req.json());
  return ok({ flow: await publishFlow(actor, policy, (await ctx.params).id, { ...opts, estimateAgentCostUsd }) });
});

/** Returns a published workflow to draft. */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  assertFlowsEnabled();
  const { actor } = await flowsRequestContext(req);
  return ok({ flow: await unpublishFlow(actor, (await ctx.params).id) });
});
