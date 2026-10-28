import { z } from 'zod';
import { ApiError, handle, ok, parse } from '@/lib/http';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import { analyzeFlow } from '@/lib/flows/analyze';
import { estimateAgentCostUsd, flowsPolicyContext, PUBLISHING_STATUS } from '../_shared';

export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 256_000;

const body = z.object({
  definition: z.unknown(),
  inputs: z.record(z.unknown()).optional(),
  fixtures: z.record(z.unknown()).optional(),
  faults: z.record(z.object({ failAttempts: z.number().int().min(0).max(6), message: z.string().max(200).optional() })).optional(),
});

/**
 * Validates, policy-checks, explains and simulates a flow definition. Stateless: nothing is saved,
 * no real data is read and no connector, model or mailbox is called.
 */
export const POST = handle(async (req) => {
  const policy = await flowsPolicyContext(req);
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new ApiError(413, `Request body is over ${MAX_BODY_CHARS} characters`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Request body is not valid JSON');
  }
  const { definition, inputs, fixtures, faults } = parse(body, json);

  const analysis = await analyzeFlow(definition, {
    registry: builtinCapabilityRegistry,
    policy,
    estimateAgentCostUsd,
    simulate: true,
    inputs,
    fixtures,
    faults,
  });
  return ok({ ...analysis, publishing: PUBLISHING_STATUS }, analysis.ok ? 200 : 422);
});
