import { z } from 'zod';
import { ApiError, handle, ok, parse } from '@/lib/http';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import { analyzeFlow } from '@/lib/flows/analyze';
import type { PolicyFinding } from '@/lib/flows/policy';
import { applyOperations, diffFlows, parseOperations } from '@/lib/flows/copilot';
import type { Def } from '@/lib/flows/edit';
import { inspectorLlmConfigured } from '@/lib/inspector/llm-configured';
import { proposeFlowEdit, type CopilotAgent, type CopilotConnection } from '@/lib/flows-copilot/propose';
import { listConnections } from '@/lib/connections/service';
import { listCatalogAgents } from '@/lib/agents/catalog';
import { assertFlowsEnabled, estimateAgentCostUsd, flowsRequestContext } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BODY_CHARS = 256_000;

const body = z.object({
  definition: z.record(z.unknown()),
  // Long enough for a pasted field list or a sample of document text.
  message: z.string().trim().min(1).max(12_000),
  // Earlier turns are context only: long ones are shortened and only the latest are kept, so a long
  // paste or a long conversation never makes the next request fail. The body cap still applies.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().transform((t) => t.slice(0, 4000)) }))
    .max(200)
    .transform((turns) => turns.slice(-20))
    .optional(),
});

/**
 * One copilot turn: the model proposes typed edits to the draft it is sent; the server applies them
 * to a copy, validates the result and runs the policy check for this user. Returns a proposal only.
 * Nothing is saved and nothing runs: the user accepts it in the editor and saves as usual.
 * One repair attempt is made when the proposed edits cannot be applied or do not validate.
 */
export const POST = handle(async (req) => {
  assertFlowsEnabled();
  const { policy, actor } = await flowsRequestContext(req);
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new ApiError(413, `Request body is over ${MAX_BODY_CHARS} characters`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'Request body is not valid JSON');
  }
  const { definition, message, history } = parse(body, json);
  if (!inspectorLlmConfigured()) throw new ApiError(503, 'The copilot needs a configured model backend on this server', { code: 'copilot_unavailable' });

  const draft = definition as Def;
  // The connections this user may use (own and shared), so the copilot can fill in a real id. Names
  // and kinds only; never settings or credentials. A failure (e.g. table not migrated) is not fatal.
  const connections: CopilotConnection[] | undefined = await listConnections(actor)
    .then((list) => list.map((c) => ({ id: c.id, name: c.name, kind: c.kind, shared: !c.mine, status: c.status })))
    .catch((e: unknown) => {
      console.warn('[flows copilot] connections unavailable:', e instanceof Error ? e.message.slice(0, 200) : e);
      return undefined;
    });
  const agents: CopilotAgent[] | undefined = await listCatalogAgents()
    .then((list) => list.map(({ slug, name, description, status, runnable, hasInstructions }) => ({ slug, name, description, status, runnable, hasInstructions })))
    .catch((e: unknown) => {
      console.warn('[flows copilot] agents unavailable:', e instanceof Error ? e.message.slice(0, 200) : e);
      return undefined;
    });
  let repairNote: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const proposal = await proposeFlowEdit({ definition: draft, message, history, repairNote, role: actor.role, connections, agents }).catch(
      (e: unknown) => ({ kind: 'error', detail: e instanceof Error ? e.message : String(e) }) as const,
    );
    if (proposal.kind === 'error') {
      console.error('[flows copilot] model call failed:', proposal.detail);
      throw new ApiError(502, `The copilot could not get an answer from the model: ${proposal.detail.slice(0, 300)}`, { code: 'copilot_model_error' });
    }
    if (proposal.kind === 'text') {
      // The provider answered without the tool. Ask once more; then pass its answer through.
      if (attempt === 0) {
        repairNote = 'You answered in plain text. Answer by calling propose_flow_changes (operations may be an empty list).';
        continue;
      }
      return ok({ reply: proposal.reply || 'I could not work out a change from that. Try describing it differently.', proposal: null });
    }

    const parsed = parseOperations(proposal.operations);
    if (!parsed.ok) {
      repairNote = parsed.errors.join('\n');
      continue;
    }
    if (parsed.operations.length === 0) return ok({ reply: proposal.reply, proposal: null });

    const applied = applyOperations(draft, parsed.operations);
    if (!applied.ok) {
      repairNote = applied.errors.join('\n');
      continue;
    }
    const check = (d: unknown) => analyzeFlow(d, { registry: builtinCapabilityRegistry, policy, estimateAgentCostUsd, simulate: false });
    const analysis = await check(applied.definition);
    if (!analysis.ok) {
      repairNote = analysis.issues.map((i) => `${i.path || '(root)'} ${i.message}`).join('\n');
      continue;
    }
    // Which findings this change introduces, so the user is not told about problems the draft already had.
    const before = await check(draft);
    const key = (f: PolicyFinding) => `${f.code}|${f.stepId ?? ''}|${f.message}`;
    const existing = new Set(before.ok ? before.findings.map(key) : []);
    return ok({
      reply: proposal.reply,
      proposal: {
        definition: applied.definition,
        changes: applied.changes,
        diff: diffFlows(draft, applied.definition),
        findings: analysis.findings,
        introduced: analysis.findings.filter((f) => !existing.has(key(f))),
      },
    });
  }
  return ok({
    reply: 'I could not turn that into a valid change to this automation. Try a smaller, more specific request, or make the change in the step panel.',
    proposal: null,
    problems: repairNote?.split('\n').slice(0, 5),
  });
});
