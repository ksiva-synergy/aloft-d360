import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { listRuns, startRun } from '@/lib/flows-store/runs';
import { estimateAgentCostUsd, flowsRequestContext } from '../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ inputs: z.record(z.unknown()).optional() });

/**
 * Runs a published automation now and returns the finished (or paused) run. Send an
 * `Idempotency-Key` header to make retries safe: the same key returns the first run.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { actor, policy } = await flowsRequestContext(req);
  const { inputs } = parse(body, await req.json().catch(() => ({})));
  const idempotencyKey = req.headers.get('idempotency-key')?.slice(0, 200) ?? undefined;
  const run = await startRun(actor, policy, (await ctx.params).id, { inputs, idempotencyKey, estimateAgentCostUsd });
  return ok({ run }, run.reused ? 200 : 201);
});

export const GET = handle<Ctx>(async (req, ctx) => {
  const { actor } = await flowsRequestContext(req);
  return ok({ runs: await listRuns(actor, (await ctx.params).id) });
});
