import type { Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import schema from '../../lib/studio/chart-dsl.schema.json';
import type { SemanticContext } from '@/lib/semantic/context-builder';

export const INSPECTOR_SYSTEM_PROMPT = `You are a data analyst helping users understand their Synergy Maritime data BEFORE they build an agent in the Agent Lab workbench.

## MANDATORY WORKFLOW — follow this order on every request

### Step 0 — Check OPERATING MEMORY first
Before any catalog search, check whether the injected OPERATING MEMORY block
(the assistant turn immediately before your first user message) already identifies
the table, schema path, or filter conditions for this query. If it does, skip
Step 1 and proceed directly to Step 2A using the recalled table path. Only run
catalog search when OPERATING MEMORY has no guidance for the current query.

### Step 1 — Search the harvested catalog FIRST (zero warehouse cost)
Always begin by calling describe_schema with action:'search', connection:'synergy_dwh', and a short natural-language query derived from what the user asked.

Example: user asks about "crew certificates" → call describe_schema action:'search' query:'crew certificates' k:8

### Step 2A — If catalog results are found
Proceed with catalog-based exploration:
- Use describe_schema action:'describe' to read column details for relevant tables
- Use describe_schema action:'profile' to check column statistics (null rates, cardinality, top values) before writing SQL
- Only call execute_tool AFTER you know the exact table path from the catalog — never use SHOW CATALOGS / SHOW SCHEMAS / SHOW TABLES as discovery tools

### Step 2B — If catalog search returns empty results or no relevant tables
DO NOT run any live SQL for exploration. Instead, respond to the user directly:

"I couldn't find **[domain]** in the harvested catalog for this connection.

To continue, you have two options:
1. **Be more specific** — if you know the exact table path (e.g. \`catalog.schema.table_name\`), share it and I'll query it directly.
2. **Run a knowledge harvest** — ask your admin to harvest this domain at **Agent Lab → Estate → Sources** so future questions about [domain] will resolve automatically."

This is not an error — it means the data exists in the warehouse but hasn't been indexed yet.

## TOOL RULES
- describe_schema is free (no warehouse queries). Use it liberally for discovery.
- execute_tool runs live SQL against the warehouse — use it only when you have a confirmed table path from the catalog.
- Valid SQL: SELECT, WITH (CTEs). No SHOW, DESCRIBE, EXPLAIN, DDL, or DML.
- Always include a LIMIT clause. Default to LIMIT 100 for sampling.
- If a SQL query fails, fall back to describe_schema to recheck the path — never guess a table name.

## RESPONSE FORMAT
- Keep responses concise and data-focused.
- Summarize what the data reveals; do not just repeat the raw table.
- End every response with 2–3 short follow-up suggestions the user can tap.`;

export const INSPECTOR_WAREHOUSE_ONLY_PROMPT = `You are a data analyst helping users explore the Synergy Maritime Databricks warehouse directly, without any pre-harvested catalog context.

## WORKFLOW
You have only one tool: execute_tool (Databricks SQL). Use it to discover and query data directly.

### Discovery — permitted SQL for navigation
- \`SHOW CATALOGS\` — list available catalogs
- \`SHOW SCHEMAS IN <catalog>\` — list schemas in a catalog
- \`SHOW TABLES IN <catalog>.<schema>\` — list tables in a schema
- \`DESCRIBE TABLE <catalog>.<schema>.<table>\` — get column names and types

### Querying — once you know the table path
- Use SELECT with a LIMIT clause. Default to LIMIT 100 for sampling.
- Use WITH (CTEs) for multi-step queries.
- No DDL or DML — read-only access only.

### Strategy
1. Start with SHOW CATALOGS if the user hasn't specified a path.
2. Drill down: catalog → schema → table → columns.
3. Sample before aggregating — check a few rows to understand the data shape.
4. If a query fails, verify the path with SHOW TABLES before retrying.

## RESPONSE FORMAT
- Keep responses concise and data-focused.
- Summarize what the data reveals; do not just repeat the raw table.
- End every response with 2–3 short follow-up suggestions the user can tap.`;

export const INSPECTOR_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'execute_tool',
      description: 'Execute SQL against the synergy_dwh Databricks warehouse. ONLY call this after confirming the table path exists in the harvested catalog via describe_schema. Always pass tool_name "synergy_dwh". Put SQL in args.statement. Valid: SELECT, WITH. Read-only. Always include LIMIT.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            tool_name: { type: 'string', description: 'Always "synergy_dwh"', default: 'synergy_dwh' },
            args: { type: 'object', properties: { statement: { type: 'string', description: 'SQL statement to execute' } }, required: ['statement'] },
          },
          required: ['tool_name', 'args'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'emit_chart',
      description: `Emit a typed chart specification from a query result. Call this whenever the user asks for a chart, visualisation, or plot. Do NOT call execute_tool first — emit_chart works on an already-returned query result.

themeSlot convention:
  'aloft-dark'  — default for all in-app DataStudio renders (dark navy surface)
  'aloft-light' — export / light-surface contexts only
When in doubt, use 'aloft-dark'.

columnId values MUST be exact column names from the query result — copy them verbatim from the result set. Valid chart kinds: bar, stacked-bar, line, area, pie, scatter, heatmap, boxplot, histogram.`,
      inputSchema: {
        json: schema,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  },
  {
    toolSpec: {
      name: 'describe_schema',
      description: "Query the platform schema catalog — zero warehouse cost, <100ms. action:'list' enumerates tables/views. action:'describe' returns the full column card (types, nullability, native_comment, freshness, semantic summary, related objects). action:'profile' returns column statistics (null_rate, cardinality, top_k values). action:'search' finds tables by natural language query. action:'relations' returns FK candidates, proposed column mappings, and entity group membership for a table. Always prefer this over db_query DESCRIBE TABLE for schema discovery. v1.3.0",
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'describe', 'profile', 'search', 'relations'],
              description: "'list': enumerate objects. 'describe': full column card + semantic. 'profile': column stats. 'search': semantic search by query string. 'relations': FK candidates, column mappings, entity groups.",
            },
            connection: { type: 'string', description: "Connection display name, e.g. 'synergy_dwh'. Required." },
            path: { type: 'string', description: "Full object path (catalog.schema.table). Required for 'describe', 'profile', 'relations'." },
            detail: { type: 'string', enum: ['compact', 'full'], description: "'compact' (default) ~200-400 tokens; 'full' returns all columns. Only for 'describe'." },
            query: { type: 'string', description: "Natural language search query. Required for 'search'." },
            k: { type: 'number', description: "Number of results for 'search'. Default 5, max 20." },
          },
          required: ['action', 'connection'],
        },
      },
    },
  },
];

/**
 * JSON Schema for emit_semantic_chart tool input — mirrors the SemanticQuery type.
 */
export const SEMANTIC_QUERY_SCHEMA = {
  type: 'object',
  properties: {
    modelId: { type: 'string', description: 'ID of the governed semantic model (from GOVERNED SEMANTIC MODEL context).' },
    entityId: { type: 'string', description: 'ID of the primary entity to query (from GOVERNED SEMANTIC MODEL context).' },
    dimensions: {
      type: 'array',
      description: 'Dimensions to group by. Use exact IDs from the GOVERNED SEMANTIC MODEL context.',
      items: {
        type: 'object',
        properties: {
          dimensionId: { type: 'string', description: 'Exact dimension ID from the governed semantic model.' },
          timeGrain: {
            type: 'string',
            enum: ['day', 'week', 'month', 'quarter', 'year'],
            description: 'Optional time grain for temporal dimensions.',
          },
        },
        required: ['dimensionId'],
      },
    },
    measures: {
      type: 'array',
      description: 'Measures to aggregate. Use exact IDs from the GOVERNED SEMANTIC MODEL context.',
      items: {
        type: 'object',
        properties: {
          measureId: { type: 'string', description: 'Exact measure ID from the governed semantic model.' },
        },
        required: ['measureId'],
      },
    },
    filters: {
      type: 'array',
      description: 'Optional filters. Can be empty array.',
      items: {
        type: 'object',
        properties: {
          fieldId: { type: 'string' },
          fieldKind: { type: 'string', enum: ['dimension', 'measure'] },
          op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'between', 'is_null', 'is_not_null'] },
          value: {},
        },
        required: ['fieldId', 'fieldKind', 'op', 'value'],
      },
    },
    sorts: {
      type: 'array',
      description: 'Optional sort order. Can be empty array.',
      items: {
        type: 'object',
        properties: {
          fieldId: { type: 'string' },
          fieldKind: { type: 'string', enum: ['dimension', 'measure'] },
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['fieldId', 'fieldKind', 'direction'],
      },
    },
    limit: { type: 'integer', minimum: 1, maximum: 10000, default: 1000, description: 'Row cap. Default 1000.' },
    timeGrain: {
      type: 'string',
      enum: ['day', 'week', 'month', 'quarter', 'year'],
      description: 'Global time grain for all temporal dimensions (per-dim grain takes precedence).',
    },
  },
  required: ['modelId', 'entityId', 'dimensions', 'measures', 'filters', 'sorts'],
} as const;

export const EMIT_SEMANTIC_CHART_TOOL: Tool = {
  toolSpec: {
    name: 'emit_semantic_chart',
    description: 'Emit a semantic chart query using governed metrics and dimensions. Use this INSTEAD of emit_chart when a semantic model is available and the requested metric appears in the GOVERNED SEMANTIC MODEL context. Select dimension and measure IDs from the provided semantic context list — use exact IDs, not column names.',
    inputSchema: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: SEMANTIC_QUERY_SCHEMA as any,
    },
  },
};

/**
 * JSON Schema for emit_disambiguation — the structured, interactive form of the
 * "refuse rather than guess" behaviour. The agent calls this INSTEAD of a plain
 * text refusal when a user's term maps to multiple governed fields (ambiguous)
 * or to none (unrecognized), so the client can render clickable candidate chips
 * rather than parsing prose.
 */
export const DISAMBIGUATION_SCHEMA = {
  type: 'object',
  properties: {
    originalTerm: { type: 'string', description: "The user's term that could not be resolved unambiguously, e.g. 'revenue'." },
    candidates: {
      type: 'array',
      description: 'Governed fields the user might have meant. Order best-match first. Use exact IDs and labels from the GOVERNED SEMANTIC MODEL context.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact dimension or measure ID from the governed semantic model.' },
          label: { type: 'string', description: 'The governed human label for this field.' },
          type: { type: 'string', enum: ['dimension', 'measure'], description: 'Whether this candidate is a dimension or a measure.' },
          relevance: {
            type: 'string',
            enum: ['exact', 'partial', 'none'],
            description: "'exact' — the term matches this field closely; 'partial' — a plausible but looser match; 'none' — offered only as a fallback.",
          },
        },
        required: ['id', 'label', 'type', 'relevance'],
      },
    },
    message: { type: 'string', description: 'A short natural-language explanation of the ambiguity and what you need from the user.' },
  },
  required: ['originalTerm', 'candidates', 'message'],
} as const;

export const EMIT_DISAMBIGUATION_TOOL: Tool = {
  toolSpec: {
    name: 'emit_disambiguation',
    description: "Ask the user to disambiguate a term that maps to multiple governed fields, or to none. Call this INSTEAD of writing a plain-text refusal whenever the requested metric/dimension is ambiguous or unrecognized in the GOVERNED SEMANTIC MODEL context. The client renders your candidates as clickable choices. Do NOT call emit_semantic_chart in the same turn — stop after this call and wait for the user to pick.",
    inputSchema: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: DISAMBIGUATION_SCHEMA as any,
    },
  },
};

export function buildToolConfig(
  contextMode: 'harvested' | 'warehouse_only',
  includeSemanticChart?: boolean,
): ToolConfiguration {
  const semanticTools = includeSemanticChart ? [EMIT_SEMANTIC_CHART_TOOL, EMIT_DISAMBIGUATION_TOOL] : [];
  if (contextMode === 'warehouse_only') {
    const baseTools = INSPECTOR_TOOLS
      .filter(t => t.toolSpec?.name !== 'describe_schema')
      .map(t => t.toolSpec?.name === 'execute_tool' ? {
        toolSpec: {
          ...t.toolSpec,
          description: 'Execute SQL against the synergy_dwh Databricks warehouse. Always pass tool_name "synergy_dwh". Put SQL in args.statement. Valid: SELECT, WITH, SHOW, DESCRIBE. Read-only. Always include LIMIT for data queries.',
        },
      } : t);
    return { tools: [...baseTools, ...semanticTools] };
  }
  return {
    tools: [...INSPECTOR_TOOLS, ...semanticTools],
  };
}

/**
 * Format governed semantic model context into a compact prompt section.
 * Capped at ~8000 chars (~2000 tokens) to stay within prompt budget.
 */
function buildSemanticPromptSection(ctx: SemanticContext): string {
  const MAX_CHARS = 8000;
  const lines: string[] = [
    '## GOVERNED SEMANTIC MODEL — prefer emit_semantic_chart for these metrics',
    '',
    'When the user asks about a metric or dimension listed below, call emit_semantic_chart with the exact IDs shown.',
    'Only fall back to emit_chart if the requested data is NOT in this list.',
    '',
    '### REFUSE RATHER THAN GUESS — use emit_disambiguation',
    'The measures and dimensions below are the ONLY governed fields available. If a',
    'user asks for a metric or dimension that does NOT appear in this list, or their',
    'term matches MORE THAN ONE governed field, do NOT invent one and do NOT substitute',
    'a plausible-looking column via raw SQL. Instead, call the emit_disambiguation tool:',
    '  - Ambiguous term (maps to several fields, e.g. "revenue" → Total Revenue, Net',
    '    Revenue, Revenue per Unit): list each matching field as a candidate with',
    "    relevance 'exact' or 'partial'.",
    '  - Unrecognized term (maps to nothing, e.g. "customer satisfaction"): list the',
    "    closest 5–10 governed fields as candidates with relevance 'partial' or 'none'.",
    'After calling emit_disambiguation, STOP and wait for the user — do not call',
    'emit_semantic_chart in the same turn. When the user replies naming a specific field',
    '(e.g. "Use Total Revenue (msr_...)"), treat it as unambiguous and proceed with',
    'emit_semantic_chart. Guessing a metric in a governed analytics product is worse than',
    'asking — a wrong-but-confident number erodes trust.',
    '',
    `Model ID: ${ctx.modelId}`,
    '',
  ];

  for (const entity of ctx.entities) {
    const entityLines: string[] = [
      `### ${entity.entityLabel} (entity: ${entity.entityId})`,
      `Path: ${entity.fullPath}`,
    ];
    if (entity.dimensions.length > 0) {
      entityLines.push('Dimensions:');
      for (const d of entity.dimensions) {
        entityLines.push(`  - ${d.label} (id: ${d.id}, type: ${d.type})`);
      }
    }
    if (entity.measures.length > 0) {
      entityLines.push('Measures:');
      for (const m of entity.measures) {
        entityLines.push(`  - ${m.label} (id: ${m.id}, agg: ${m.aggregate}, type: ${m.metricType})`);
      }
    }
    entityLines.push('');

    const tentative = [...lines, ...entityLines].join('\n');
    if (tentative.length > MAX_CHARS) break;
    lines.push(...entityLines);
  }

  return lines.join('\n');
}

export function buildSystemPrompt(
  contextMode: 'harvested' | 'warehouse_only',
  semanticContext?: SemanticContext,
): string {
  const base = contextMode === 'warehouse_only' ? INSPECTOR_WAREHOUSE_ONLY_PROMPT : INSPECTOR_SYSTEM_PROMPT;
  if (!semanticContext || semanticContext.entities.length === 0) return base;
  const semanticSection = buildSemanticPromptSection(semanticContext);
  return `${base}\n\n${semanticSection}`;
}

export async function buildInsightsContext(sessionId: string | undefined): Promise<string> {
  if (!sessionId) return '';
  try {
    const rows = await prisma.studio_insights.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' },
      select: { insights: true, created_at: true },
    });
    if (rows.length === 0) return '';

    type InsightItem = { headline: string; body: string; kind: string; confidence: string };
    const lines: string[] = ['--- PRIOR ANALYSIS INSIGHTS FROM THIS SESSION ---'];
    rows.forEach((row, ri) => {
      const items = (row.insights as InsightItem[]) || [];
      if (items.length === 0) return;
      lines.push(`Query ${ri + 1}:`);
      items.forEach(item => {
        lines.push(`  [${item.kind}/${item.confidence}] ${item.headline} — ${item.body}`);
      });
    });
    lines.push('--- END PRIOR INSIGHTS ---');
    return lines.join('\n');
  } catch {
    return '';
  }
}
