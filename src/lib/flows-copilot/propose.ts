import type { ContentBlock, Message, Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import { runAgentLoop, type AgentLoopParams } from '@/lib/inspector/agent-loop';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { hasXaiCredentials } from '@/lib/inspector/llm-configured';
import { resolveBoostModel, resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import type { BoostModel } from '@/lib/boost/models';
import { BUILTIN_CAPABILITIES } from '@/lib/capabilities/builtin';
import type { Def } from '@/lib/flows/edit';

// Model adapter for the Flows copilot. The model may only answer by calling one forced tool that
// proposes typed edit operations (src/lib/flows/copilot.ts). It cannot save, run, or call anything:
// the route applies the operations to a copy of the draft, validates and policy-checks the result,
// and the user accepts or discards it. Lives outside src/lib/flows because it imports the
// Inspector agent loop and Bedrock types (flows/__tests__/boundary.test.ts).

export const PROPOSE_TOOL_NAME = 'propose_flow_changes';

const PROPOSE_TOOL: Tool = {
  toolSpec: {
    name: PROPOSE_TOOL_NAME,
    description:
      'Reply to the user and propose edits to their workflow draft as an ordered list of operations. ' +
      'Nothing is applied until the user accepts. Use an empty operations list to answer a question without changing anything.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: 'Short, plain-language answer to the user: what you changed and why, or what you need from them.' },
          operations: {
            type: 'array',
            description: 'Edits, applied in order. Each item has an "op" and that op\'s fields.',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: ['set_name', 'set_description', 'set_trigger', 'set_budget', 'add_input', 'remove_input', 'add_step', 'update_step', 'remove_step', 'rename_step'],
                },
                name: { type: 'string' },
                description: { type: 'string' },
                trigger: { type: 'object', description: '{ type: manual|schedule|event|webhook, cron?, name? }' },
                maxCostUsd: { type: ['number', 'null'] },
                input: { type: 'object', description: '{ name, type: string|number|boolean, required?, default?, description? }' },
                step: { type: 'object', description: '{ id, type, name?, dependsOn?, when?, retries?, config }' },
                id: { type: 'string' },
                dependsOn: { type: 'array', items: { type: 'string' } },
                when: { type: ['object', 'null'], description: '{ ref: "{{steps.x.y}}", operator, value } or null to remove' },
                retries: { type: 'integer' },
                config: { type: 'object', description: 'Keys merged into the step config; a key set to null is removed.' },
                from: { type: 'string' },
                to: { type: 'string' },
              },
              required: ['op'],
            },
          },
        },
        required: ['reply', 'operations'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  },
};

function toolConfig(): ToolConfiguration {
  return { tools: [PROPOSE_TOOL], toolChoice: { tool: { name: PROPOSE_TOOL_NAME } } };
}

function renderCapabilities(): string {
  return BUILTIN_CAPABILITIES.map((c) => {
    const fields = Object.entries(c.fields)
      .map(([k, f]) => `      ${k}${f.required ? '' : '?'} (${f.binding === 'literal' ? 'fixed value, no {{refs}}' : 'may use {{refs}}'}): ${f.description}`)
      .join('\n');
    return `  - ${c.id} "${c.title}" — ${c.description} [effect: ${c.sideEffect}; approval: ${c.approval}]\n${fields}`;
  }).join('\n');
}

/** Stable across requests (catalog and rules only), so it can be prompt-cached. */
export function buildCopilotSystemPrompt(): string {
  return [
    'You help a business user edit an automated workflow in ALOFT Flows. You see their current draft as JSON.',
    'You change it ONLY by calling propose_flow_changes with typed operations. The user reviews and accepts or discards them.',
    'ALWAYS answer by calling propose_flow_changes, even for a question: put your answer in "reply" and use an empty operations list. Never answer in plain text.',
    '',
    'WORKFLOW SHAPE',
    '- name, description?, trigger, inputs[], budget? { maxCostUsd }, steps[] (1–40).',
    '- trigger: { type: "manual" } | { type: "schedule", cron: 5-field UTC cron } | { type: "event", name } | { type: "webhook", name: lowercase-with-dashes }.',
    '- inputs: { name: snake_case, type: string|number|boolean, required, default? }. Reference as {{inputs.name}}.',
    '- step: { id: snake_case unique, type, name?, dependsOn?: [ids], when?: { ref: "{{steps.id.field}}", operator: eq|neq|gt|gte|lt|lte|contains, value }, retries?: 0–5, config }.',
    '- Reference an earlier step\'s output as {{steps.<id>.<field>}} (query/transform: rows, rowCount; agent: text; retrieve: chunks). A reference creates the dependency automatically.',
    '',
    'STEP CONFIG BY TYPE',
    '- query: { semantic: { modelId, entityId, dimensions: [{ dimensionId, timeGrain? }], measures: [{ measureId }], filters: [{ fieldId, fieldKind: "dimension"|"measure", op: eq|neq|gt|gte|lt|lte|in|not_in|between|is_null|is_not_null, value }], sorts: [{ fieldId, fieldKind, direction: asc|desc }] }, maxRows } — governed; preferred. Use exactly these keys. Or { sql, maxRows } (raw read-only, needs the flow:sql permission; avoid).',
    '- retrieve: { query, topK } — search the knowledge base.',
    '- agent: { prompt, agentSlug?, model? } — ask AI. Data from earlier steps is treated as data, not instructions.',
    '- transform: { op: "filter", input: "{{steps.x.rows}}", field, operator, value } | { op: "limit", input, count } | { op: "count", input } | { op: "anti_join", input, other, key, otherKey? }.',
    '- approval: { message, assignee?: email } — a person must approve before later steps run.',
    '- output: { kind: "save", title, content } — save a result.',
    '- tool: { capability: <id>, input: { … } } — call a connector operation. Available capabilities:',
    renderCapabilities(),
    '',
    'RULES',
    '- Make the smallest set of changes that does what the user asked. Do not rewrite steps they did not mention.',
    '- Never remove or bypass an approval step unless the user explicitly asks; say that publishing may then be blocked.',
    '- A step that writes to or sends outside the platform needs an approval step before it (dependsOn chain). Add one when you add such a step.',
    '- Never invent connection ids, semantic model/entity/measure ids, agent slugs or email addresses. Use a clear placeholder such as "CHOOSE_CONNECTION" and tell the user what to fill in.',
    '- Operations apply in order, so add a step before another step depends on it. Use update_step with only the fields that change.',
    '- If the request is unclear or impossible with these step types, ask a short question and return no operations.',
    '- Keep the reply to a few sentences in plain language. No JSON in the reply.',
  ].join('\n');
}

export type CopilotTurn = { role: 'user' | 'assistant'; text: string };

export type ProposeOutcome =
  /** The model called the tool. `operations` is unparsed. */
  | { kind: 'proposal'; reply: string; operations: unknown }
  /** The model answered in text without proposing anything (some providers ignore the forced tool). */
  | { kind: 'text'; reply: string }
  /** The model call failed. `detail` is the provider's message. */
  | { kind: 'error'; detail: string };

/**
 * The model the copilot uses: `FLOWS_COPILOT_MODEL_ID` (a Bedrock model id) when set; otherwise Grok
 * (XAI_MODEL, default grok-4.7) when xAI is configured (decision 2026-10-27); otherwise the model the
 * Workbench resolves for this user's role.
 */
function copilotModel(role?: string | null): { modelId: string; boost: BoostModel | null } {
  const override = process.env.FLOWS_COPILOT_MODEL_ID?.trim();
  if (override) return { modelId: override, boost: null };
  const grok = hasXaiCredentials() ? resolveBoostModel('grok-xai') : null;
  if (grok) return { modelId: grok.modelId, boost: grok };
  const resolved = resolveWorkbenchModel(undefined, role);
  return { modelId: resolved?.effectiveModelId ?? 'us.anthropic.claude-sonnet-5-5', boost: resolved?.boostModel ?? null };
}

/**
 * One copilot turn. `repairNote` asks the model to fix a previous proposal that failed. When the
 * primary model is not Grok and its call fails, it retries once with Grok if xAI is configured, as
 * the Workbench does.
 */
export async function proposeFlowEdit(params: {
  definition: Def;
  message: string;
  history?: CopilotTurn[];
  repairNote?: string;
  role?: string | null;
}): Promise<ProposeOutcome> {
  const turns: Message[] = (params.history ?? []).slice(-6).map((t) => ({ role: t.role, content: [{ text: t.text } as ContentBlock] }));
  const userText = [
    'Current workflow draft:',
    '```json',
    JSON.stringify(params.definition, null, 2),
    '```',
    '',
    params.repairNote ? `Your previous proposal could not be applied:\n${params.repairNote}\nPropose a corrected set of operations for my request.` : '',
    `My request: ${params.message}`,
  ]
    .filter(Boolean)
    .join('\n');
  // Bedrock requires alternating roles starting with the user.
  while (turns.length && turns[0]!.role !== 'user') turns.shift();
  const messages: Message[] = [...turns, { role: 'user', content: [{ text: userText } as ContentBlock] }];

  let captured: { reply: string; operations: unknown } | null = null;
  const run = (modelId: string, boost: BoostModel | null) => {
    const abortSignal = { value: false };
    const loop: AgentLoopParams = {
      modelId,
      systemPrompt: buildCopilotSystemPrompt(),
      messages,
      tools: toolConfig(),
      executeTool: async (name, input) => {
        if (name !== PROPOSE_TOOL_NAME) return 'Unknown tool.';
        captured = { reply: typeof input.reply === 'string' ? input.reply : '', operations: input.operations ?? [] };
        abortSignal.value = true; // one proposal per turn; skip the follow-up call
        return 'Proposal received.';
      },
      // Same reason as the blueprint proposer: maxLoops 1 would drop the forced tool.
      maxLoops: 2,
      supportsTools: true,
      supportsThinking: false,
      cacheSystemPrompt: true,
      abortSignal,
    };
    return boost ? dispatchAgentLoop(boost, loop) : runAgentLoop(loop);
  };

  const { modelId, boost } = copilotModel(params.role);
  let result = await run(modelId, boost);
  if (!captured && result.outcome === 'errored' && boost?.key !== 'grok-xai' && hasXaiCredentials()) {
    const grok = resolveBoostModel('grok-xai');
    if (grok) result = await run(grok.modelId, grok);
  }
  const proposal = captured as { reply: string; operations: unknown } | null;
  if (proposal) return { kind: 'proposal', ...proposal };
  if (result.outcome === 'errored') return { kind: 'error', detail: result.errorDetail ?? 'The model call failed' };
  const text = result.finalText?.trim() ?? '';
  return toolCallWrittenAsText(text) ?? { kind: 'text', reply: text };
}

/**
 * Some providers (seen with Grok 4.7) write the tool's arguments as the message text instead of
 * calling the tool. Accept that only when the whole text is one JSON object with a string `reply`.
 */
export function toolCallWrittenAsText(text: string): ProposeOutcome | null {
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (!body.startsWith('{')) return null;
  try {
    const v = JSON.parse(body) as { reply?: unknown; operations?: unknown };
    if (typeof v.reply !== 'string') return null;
    return { kind: 'proposal', reply: v.reply, operations: v.operations ?? [] };
  } catch {
    return null;
  }
}
