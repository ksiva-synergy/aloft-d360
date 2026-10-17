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
- When name, instructions (≥40 chars), and class are set, tell the user they can press COMMISSION.`;

export function buildWorkbenchSystemPrompt(state: ConstructionState): string {
  return `${WORKBENCH_SYSTEM_PROMPT}

CURRENT CONSTRUCTION STATE (JSON):
${JSON.stringify(state, null, 2)}`;
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
