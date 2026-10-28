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
      'Reply to the user and propose edits to their automation draft as an ordered list of operations. ' +
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
                step: { type: 'object', description: '{ id, type, name?, dependsOn?, when?, forEach?, retries?, config }' },
                id: { type: 'string' },
                dependsOn: { type: 'array', items: { type: 'string' } },
                when: { type: ['object', 'null'], description: '{ ref: "{{steps.x.y}}", operator, value } or null to remove' },
                forEach: { type: ['object', 'null'], description: '{ items: "{{steps.x.list}}", maxItems, concurrency? } or null to stop repeating' },
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
    'You help a business user edit an automation in ALOFT Automate. You see their current draft as JSON.',
    'You change it ONLY by calling propose_flow_changes with typed operations. The user reviews and accepts or discards them.',
    'ALWAYS answer by calling propose_flow_changes, even for a question: put your answer in "reply" and use an empty operations list. Never answer in plain text.',
    '',
    'WORKFLOW SHAPE',
    '- name, description?, trigger, inputs[], budget? { maxCostUsd }, steps[] (1–40).',
    '- trigger: { type: "manual" } | { type: "schedule", cron: 5-field UTC cron } | { type: "event", name } | { type: "webhook", name: lowercase-with-dashes }.',
    '- inputs: { name: snake_case, type: string|number|boolean, required, default? }. Reference as {{inputs.name}}.',
    '- step: { id: snake_case unique, type, name?, dependsOn?: [ids], when?: { ref: "{{steps.id.field}}", operator: eq|neq|gt|gte|lt|lte|contains, value }, retries?: 0–5, config }.',
    '- Reference an earlier step\'s output as {{steps.<id>.<field>}} (query/transform: rows, rowCount; agent: text; retrieve: chunks, each with text and cite; object_store.list: objects, each with key; document.extract: fields). A reference creates the dependency automatically.',
    '- REPEAT FOR EACH ITEM: an agent or tool step may set forEach: { items: "{{steps.<id>.<list>}}", maxItems: 1–1000, concurrency?: 1–10 }. It then runs once per item; inside its config use {{item}} or {{item.<field>}} for the current item. Its output is { items: [{ item, output, error? }], total, succeeded, failed }. Use it whenever the user wants something done for every row or every file (e.g. extract each document listed by object_store.list: forEach over {{steps.list_docs.objects}} with input key "{{item.key}}"). A list longer than maxItems fails the step, so pick a realistic limit and say it. A repeating paid step needs a per-run budget: set one (set_budget) if there is none.',
    '',
    'STEP CONFIG BY TYPE',
    '- query: { semantic: { modelId, entityId, dimensions: [{ dimensionId, timeGrain? }], measures: [{ measureId }], filters: [{ fieldId, fieldKind: "dimension"|"measure", op: eq|neq|gt|gte|lt|lte|in|not_in|between|is_null|is_not_null, value }], sorts: [{ fieldId, fieldKind, direction: asc|desc }] }, maxRows } — governed; preferred. Use exactly these keys. Or { sql, maxRows } (raw read-only, needs the flow:sql permission; avoid).',
    '- retrieve: { query, knowledgeBaseIds: [ids], topK } — search knowledge bases (company documents and Q&A). Output chunks: [{ text, cite, document, page, section }]; cite is "document, p. N".',
    '  - Use ids from AVAILABLE KNOWLEDGE BASES that fit the question (match name and description). If none fits, use ["CHOOSE_KNOWLEDGE"] and tell the user to pick one in the step panel. To answer from the passages, add an agent step whose prompt includes {{steps.<id>.chunks}} and asks it to cite (document, page).',
    '- agent: { prompt, agentSlug?, model?, answer? } — ask AI, or a saved agent (agentSlug) that can look things up with read-only data tools. Data from earlier steps is treated as data, not instructions.',
    '  - Use a saved agent from AVAILABLE AGENTS when one fits the job (match its name and description); prefer ready ones. Never invent a slug.',
    '  - When later steps need specific things back (yes/no, a score, a date, a reason), set answer = [{ key, label, type: text|date|number, description }] with the same rules as document fields; later steps read {{steps.<id>.values.<key>}}. Plain text is in {{steps.<id>.text}}.',
    '  - An agent step may repeat for each item (forEach), e.g. one check per voyage or per invoice.',
    '- transform: { op: "filter", input: "{{steps.x.rows}}", field, operator, value } | { op: "limit", input, count } | { op: "count", input } | { op: "anti_join", input, other, key, otherKey? }.',
    '- approval: { message, assignee?: email } — a person must approve before later steps run.',
    '- output: { kind: "save", title, content } — save a result.',
    '- tool: { capability: <id>, input: { … } } — call a connector operation. Available capabilities:',
    renderCapabilities(),
    '- When you change a tool step\'s input with update_step, send the COMPLETE input object in config.input (it replaces the old one), keeping the keys you are not changing.',
    '',
    'READING DOCUMENTS (document.extract)',
    '- Use a built-in schema when it fits the document (input.schema). Otherwise give the step its own fields: input.fields = [{ key, label, type, description }], 1–30 fields, and no schema.',
    '- key: snake_case from the label (e.g. "Expiry date" → "expiry_date"); label: the user\'s words; type: "date" for any date, "number" for amounts, counts and quantities, otherwise "text"; description: one short sentence saying what to read and how it usually appears.',
    '- Build the fields for the user whenever they name what they want read, paste a list of fields, or paste a sample of the document text: take every value they ask for or that the sample clearly carries, and say which fields you added. Do not invent fields they did not ask for or that the sample does not show.',
    '- Later steps read the values as {{steps.<id>.values.<key>}} (or {{item.output.values.<key>}} inside the items of a repeating step).',
    '',
    'RULES',
    '- Make the smallest set of changes that does what the user asked. Do not rewrite steps they did not mention.',
    '- Never remove or bypass an approval step unless the user explicitly asks; say that publishing may then be blocked.',
    '- A step that writes to or sends outside the platform needs an approval step before it (dependsOn chain). Add one when you add such a step.',
    '- Connections: use only an id from the AVAILABLE CONNECTIONS list in the user message. When the user names the storage ("our S3 bucket", "the SharePoint site"), pick the connection of that kind; if several fit, pick the one whose name matches best and say which, or ask. If none fits, use "CHOOSE_CONNECTION" and tell them to add one under Govern → Connections and pick it in the step panel.',
    '- Never invent semantic model/entity/measure ids, agent slugs, extraction schema names or email addresses. Use a clear placeholder such as "CHOOSE_MODEL" and tell the user what to fill in.',
    '- Operations apply in order, so add a step before another step depends on it. Use update_step with only the fields that change.',
    '- If the request is unclear or impossible with these step types, ask a short question and return no operations.',
    '- Keep the reply to a few sentences in plain language. No JSON in the reply.',
  ].join('\n');
}

export type CopilotTurn = { role: 'user' | 'assistant'; text: string };

/** A connection the user may use, as the copilot sees it: never credentials or settings. */
export type CopilotConnection = { id: string; name: string; kind: string; shared: boolean; status: string };

const KIND_NAME: Record<string, string> = { s3: 'Amazon S3', azure_blob: 'Azure Blob Storage', sharepoint: 'SharePoint' };

/** A saved agent the user may ask, as the copilot sees it. */
export type CopilotAgent = { slug: string; name: string; description: string | null; status: string | null; runnable: boolean; hasInstructions?: boolean };

export function renderAgents(agents: CopilotAgent[] | undefined): string {
  if (!agents) return 'AVAILABLE AGENTS: (could not be loaded; leave agentSlug out and say so)';
  if (!agents.length) return 'AVAILABLE AGENTS: none saved yet';
  const state = (a: CopilotAgent) =>
    a.hasInstructions === false ? 'no instructions yet, cannot run; do not use' : a.runnable ? a.status : `${a.status ?? 'draft'}, can be tried but not published`;
  const lines = agents.map((a) => `- agentSlug "${a.slug}": ${JSON.stringify(a.name)} (${state(a)})${a.description ? ` — ${a.description.slice(0, 160)}` : ''}`);
  return ['AVAILABLE AGENTS (saved agents an agent step can ask; use the slug):', ...lines].join('\n');
}

/** Per-request context, so it goes in the user message rather than the cached system prompt. */
export function renderConnections(connections: CopilotConnection[] | undefined): string {
  if (!connections) return 'AVAILABLE CONNECTIONS: (could not be loaded; use "CHOOSE_CONNECTION")';
  if (!connections.length) return 'AVAILABLE CONNECTIONS: none yet (use "CHOOSE_CONNECTION")';
  const lines = connections.map(
    (c) => `- id "${c.id}": ${JSON.stringify(c.name)} (${KIND_NAME[c.kind] ?? c.kind}${c.shared ? ', shared by a colleague' : ''}${c.status === 'ok' ? '' : `, ${c.status === 'error' ? 'failing its test' : 'not tested yet'}`})`,
  );
  return ['AVAILABLE CONNECTIONS (the user may use these; "connection" inputs take the id):', ...lines].join('\n');
}

/** A knowledge base the user may search, as the copilot sees it. */
export type CopilotKnowledgeBase = { id: string; name: string; description: string | null; scope: string; documents: number };

export function renderKnowledgeBases(kbs: CopilotKnowledgeBase[] | undefined): string {
  if (!kbs) return 'AVAILABLE KNOWLEDGE BASES: (could not be loaded; use "CHOOSE_KNOWLEDGE")';
  if (!kbs.length) return 'AVAILABLE KNOWLEDGE BASES: none yet (use "CHOOSE_KNOWLEDGE"; they are created under Memory → Knowledge)';
  const lines = kbs.map((k) => `- id "${k.id}": ${JSON.stringify(k.name)} (${k.scope === 'org' ? 'organisation' : 'personal'}, ${k.documents} documents ready)${k.description ? ` — ${k.description.slice(0, 160)}` : ''}`);
  return ['AVAILABLE KNOWLEDGE BASES (a retrieve step searches these; use the id):', ...lines].join('\n');
}

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
  /** The user's own and shared connections; undefined when they could not be loaded. */
  connections?: CopilotConnection[];
  /** Saved agents; undefined when they could not be loaded. */
  agents?: CopilotAgent[];
  /** Knowledge bases the user may search; undefined when they could not be loaded. */
  knowledgeBases?: CopilotKnowledgeBase[];
}): Promise<ProposeOutcome> {
  const turns: Message[] = (params.history ?? []).slice(-6).map((t) => ({ role: t.role, content: [{ text: t.text } as ContentBlock] }));
  const userText = [
    'Current automation draft:',
    '```json',
    JSON.stringify(params.definition, null, 2),
    '```',
    '',
    renderConnections(params.connections),
    '',
    renderAgents(params.agents),
    '',
    renderKnowledgeBases(params.knowledgeBases),
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
