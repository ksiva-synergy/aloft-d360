import type { ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import type { ConstructionState } from './constructionState';

export const WORKBENCH_SYSTEM_PROMPT = `You are the ALOFT Agent Lab workbench assistant. Your job is to help the user design and commission a durable AI agent (not ad-hoc data chat).

Interview the user to learn:
- Agent name and one-line purpose
- Agent class (feynman | fermi | grossmann | rama) when appropriate
- System instructions / persona
- Data sources (Databricks, knowledge base, APIs) and tools they need
- Expected outputs (JSON shape, reports, actions)

Rules:
- Be concise and structured. Confirm assumptions explicitly.
- After learning something material, call update_agent_draft to persist it.
- Use add_assumption for inferred facts the user has not confirmed yet.
- Do not run SQL or query warehouses — the user explores data in Inspector first.
- The user can also edit the draft directly in the Config panel. Fields whose provenance is "user" belong to the user:
  never overwrite them on your own (the tool returns USER_LOCKED). Only change a user-owned field when the user asks
  you to in chat, and then pass source "user".
- Datasources with provenance "template" were carried over from the user's Inspector session; treat them as confirmed
  context the agent should use, and name them when you summarise the draft.
- When name, instructions (≥40 chars), and class are set, suggest a Test run in the Config panel (it runs one sample
  question against live data using the draft instructions), then tell the user they can press COMMISSION.`;

export function buildWorkbenchSystemPrompt(state: ConstructionState): string {
  return `${WORKBENCH_SYSTEM_PROMPT}

CURRENT CONSTRUCTION STATE (JSON):
${JSON.stringify(state, null, 2)}`;
}

/**
 * System prompt for a workbench Test run: the draft agent's own instructions plus
 * the read-only data rules every Inspector-backed agent follows.
 */
export function buildTestRunSystemPrompt(state: ConstructionState): string {
  const name = state.name?.trim() || 'Untitled agent';
  const sources = state.tools.datasources
    .map((d) => `- ${d.kind}: ${d.ref}${d.scope ? ` (${d.scope})` : ''}`)
    .join('\n');
  return `You are "${name}", an agent being test-run before it is commissioned.
${state.prompt.persona ? `\nPurpose: ${state.prompt.persona}\n` : ''}
## YOUR INSTRUCTIONS
${state.prompt.instructions.trim() || '(No instructions written yet.)'}

## DATA SOURCES
${sources || '- None declared. Find the right tables with describe_schema.'}

## DATA RULES
- Prefer the declared data sources. If a table path is not declared, confirm it with describe_schema (action:'search', then 'describe') before querying.
- execute_tool runs read-only SQL against synergy_dwh. SELECT / WITH only, always fully qualified table names, always LIMIT (100 or less).
- Never guess a table or column name. If a query fails, recheck the path with describe_schema.
- Keep the final answer concise, in markdown, with key numbers in bold. Do not narrate tool steps.`;
}

export function buildWorkbenchToolConfig(): ToolConfiguration {
  return {
    tools: [
      {
        toolSpec: {
          name: 'update_agent_draft',
          description:
            'Persist a field on the agent under construction. Use dot paths: name, class.id, prompt.instructions, prompt.persona, tools.datasources, readiness.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Dot-path field name' },
                value: { description: 'New value (string, number, object, or array)' },
                source: { type: 'string', enum: ['ai', 'user', 'template'] },
              },
              required: ['field', 'value'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'add_assumption',
          description: 'Record an inferred assumption the user should confirm or correct.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                value: {},
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                rationale: { type: 'string' },
              },
              required: ['field', 'value', 'confidence', 'rationale'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'add_datasource',
          description: 'Attach a datasource reference (kb, databricks, mcp, api).',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['kb', 'databricks', 'mcp', 'api'] },
                ref: { type: 'string' },
                scope: { type: 'string' },
              },
              required: ['kind', 'ref'],
            },
          },
        },
      },
    ],
  };
}
