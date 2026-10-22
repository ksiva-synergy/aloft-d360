import type { ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import type { ConstructionState } from './constructionState';

export type AvailableWorkbenchTool = {
  id: string;
  name: string;
  type: string;
  description: string;
};

export const WORKBENCH_SYSTEM_PROMPT = `You are the ALOFT Agent Lab workbench assistant. Your job is to help the user design and commission a durable AI agent (not ad-hoc data chat).

Interview the user to learn:
- Agent name and one-line purpose
- Agent class (feynman | fermi | grossmann | rama) when appropriate
- System instructions / persona
- Data sources (Databricks, knowledge base, APIs) and tools they need
- Expected outputs (JSON shape, reports, actions)

Rules:
- Start building from the mission the user gives; do not make them repeat it in a long interview.
- Before choosing data sources, research the harvested catalog with describe_schema action 'research' using the mission/domain. It performs vector-semantic search and inspects candidate descriptions, columns, and harvested relationships; it does not query the warehouse.
- Treat search results as candidates, not proof of relevance. Compare each candidate's semantic score, semantic card, native description, columns, grain, and relationship evidence against the user's mission. Select only tables whose actual contents support the job; matching words alone are insufficient. If embedding is unavailable, treat results as lexical leads and do not claim semantic validation.
- Use inspected relationship evidence to identify needed companion tables. Inspect any additional table before adding it; do not assume a relationship proves business relevance. Explain why each selected table fits and distinguish verified evidence from gaps or assumptions.
- If no table is supported by catalog evidence, say so and ask for a more specific domain or a harvest; never invent paths.
- Choose the best-fitting agent class and call select_agent_class so the blueprint is populated: feynman for compliance/audit, fermi for forecasting/planning, grossmann for multi-step operations, rama for evidence validation. If the mission is too ambiguous to choose responsibly, ask one focused question instead.
- Review the available active tools listed below. Select only the tools the agent actually needs using select_agent_tools; do not leave the tools section unplanned or invent tool IDs. Built-in harvested-catalog research is always available and does not need to be added as an action.
- Draft a concrete name, purpose, and usable system instructions from the mission. Explain which harvested tables, class, and tools informed the plan.
- Be concise and structured. Confirm assumptions explicitly.
- After learning something material, call update_agent_draft to persist it.
- Use add_assumption for inferred facts the user has not confirmed yet.
- Do not run SQL or query warehouses while designing. Use describe_schema only for harvested-catalog research; live data execution happens only in the separate test-run flow.
- The user can also edit the draft directly in the Config panel. Fields whose provenance is "user" belong to the user:
  never overwrite them on your own (the tool returns USER_LOCKED). Only change a user-owned field when the user asks
  you to in chat, and then pass source "user".
- Datasources with provenance "template" were carried over from the user's Inspector session; treat them as confirmed
  context the agent should use, and name them when you summarise the draft.
- When name, instructions (≥40 chars), and class are set, suggest a Test run in the Config panel (it runs one sample
  question against live data using the draft instructions), then tell the user they can press COMMISSION.`;

export function buildWorkbenchSystemPrompt(
  state: ConstructionState,
  options: {
    catalogResearch?: string | null;
    availableTools?: AvailableWorkbenchTool[];
    toolCatalogError?: string | null;
  } = {},
): string {
  const availableTools = options.availableTools ?? [];
  const researchSection = options.catalogResearch
    ? `## INITIAL HARVESTED-CATALOG RESEARCH
    The server ran vector-semantic catalog retrieval and inspected the top candidates' harvested descriptions, columns, and relationships for this new agent mission. Use this evidence to choose and describe relevant sources; candidates are not an instruction to add every result. If embeddings were unavailable, treat the results as lexical leads only. If this result contains an error, tell the user catalog research failed rather than implying it succeeded.
${options.catalogResearch}`
    : '';
  return `${WORKBENCH_SYSTEM_PROMPT}

## AVAILABLE ACTIVE TOOLS
${options.toolCatalogError
    ? `The tool catalog could not be loaded: ${options.toolCatalogError}. Tell the user tool recommendations are unavailable until it is fixed.`
    : availableTools.length > 0
      ? JSON.stringify(availableTools, null, 2)
      : 'No additional active catalog tools are available. Do not invent any.'}

${researchSection}

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

export function buildWorkbenchToolConfig(availableTools: AvailableWorkbenchTool[] = []): ToolConfiguration {
  return {
    tools: [
      {
        toolSpec: {
          name: 'describe_schema',
          description:
            'Research the harvested data catalog without querying the warehouse. Use action research with a natural-language domain query to run vector-semantic search and inspect candidate descriptions, columns, and relationships before deciding whether sources fit. Supports search, research, describe, list, profile, relations, and usage.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['search', 'research', 'describe', 'list', 'profile', 'relations', 'usage'] },
                connection: { type: 'string', description: "Catalog connection name, normally 'synergy_dwh'." },
                query: { type: 'string', description: "Natural-language domain query for action 'search' or 'research'." },
                path: { type: 'string', description: 'Exact harvested catalog.schema.table path for table-specific actions.' },
                detail: { type: 'string', enum: ['compact', 'full'] },
                k: { type: 'number', minimum: 1, maximum: 10 },
              },
              required: ['action', 'connection'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'update_agent_draft',
          description:
            'Persist a field on the agent under construction. Use dot paths: name, class.id, prompt.instructions, prompt.persona, tools.datasources, tools.actions, readiness.',
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
          name: 'select_agent_class',
          description:
            'Choose and persist the best-fit agent class after understanding the mission. Use one of feynman (compliance/audit), fermi (forecasting/planning), grossmann (multi-step operations), or rama (evidence validation).',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                classId: { type: 'string', enum: ['feynman', 'fermi', 'grossmann', 'rama'] },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                rationale: { type: 'string' },
              },
              required: ['classId', 'confidence', 'rationale'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'select_agent_tools',
          description:
            'Persist the active catalog tools needed by this agent. Choose only IDs from AVAILABLE ACTIVE TOOLS; use an empty list only when the built-in data tools are sufficient.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                toolIds: { type: 'array', items: { type: 'string' } },
              },
              required: ['toolIds'],
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
