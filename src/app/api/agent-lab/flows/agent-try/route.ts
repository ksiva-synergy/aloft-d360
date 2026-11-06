import { z } from 'zod';
import { ApiError, handle, ok, parse } from '@/lib/http';
import { writeAudit } from '@/lib/audit';
import { inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { AgentRunError, runCatalogAgent } from '@/lib/agents/run-catalog-agent';
import type { CustomField } from '@/lib/extraction/schemas';
import { extractRefs } from '@/lib/flows/validate';
import { flowsRequestContext } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const body = z.object({
  agentSlug: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(12_000),
  answer: z.array(z.record(z.unknown())).max(30).optional(),
  model: z.string().trim().max(200).optional(),
});

/**
 * "Try it" for an Ask-an-agent step: one real run of the saved agent with this prompt, using the
 * agent's read-only data tools. Nothing is saved except the run's metrics (agent_turn_log, surface
 * `automation`) and an audit entry. The prompt must not contain {{refs}}: there is no run data to
 * fill them, so the person replaces them with sample values first.
 */
export const POST = handle(async (req) => {
  const { actor } = await flowsRequestContext(req);
  const input = parse(body, await req.json().catch(() => ({})));
  const refs = extractRefs(input.prompt);
  if (refs.length) {
    throw new ApiError(422, `Replace ${refs.map((r) => r.raw).slice(0, 3).join(', ')}${refs.length > 3 ? '…' : ''} with sample values to try the agent`, { code: 'unresolved_refs' });
  }
  if (!inspectorLlmConfigured()) throw new ApiError(503, 'Using an agent needs a configured model backend on this server', { code: 'agents_unavailable' });

  try {
    const result = await runCatalogAgent({
      slug: input.agentSlug,
      message: input.prompt,
      role: actor.role,
      model: input.model,
      answer: input.answer as CustomField[] | undefined,
      surface: 'automation',
      person: { userId: actor.userId, role: actor.role },
    });
    await writeAudit({
      actorId: actor.userId,
      action: 'agent.tried',
      entityType: 'agent',
      entityId: result.agent.id,
      // What ran and what it cost; not the prompt or the answer.
      after: { slug: input.agentSlug, model: result.model, outcome: result.outcome, loops: result.loops, toolCalls: result.toolCalls, costUsd: result.costUsd, turnId: result.turnId },
    });
    return ok(result);
  } catch (e) {
    if (e instanceof AgentRunError) throw new ApiError(e.status, e.message);
    throw e;
  }
});
