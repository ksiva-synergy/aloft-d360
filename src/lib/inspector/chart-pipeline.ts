import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { emitChartSpec } from './chart-emitter';
import { validateAndRepair, type ValidationResult } from '@/lib/studio/validator';
import { compileSpecToOption } from '@/lib/studio/compiler';
import type { ChartDSLSpec } from '@/lib/studio/types';
import type { ProfileResult } from '@/lib/studio/types';
import type { QueryResult } from '@/hooks/useInspectorChat';
import schema from '../../lib/studio/chart-dsl.schema.json';
import { validateSemanticQuery } from '@/lib/semantic/types';
import { executeSemanticQuery } from '@/lib/semantic/execute';
import { profileResultSet } from '@/lib/studio/profiler';
import prisma from '@/lib/db';
import type { SemanticQuery, SemanticValidationError } from '@/lib/semantic/types';
import {
  recommendChartKind,
  type ChartRecommendation,
  type ResolvedDefinitions,
} from '@/lib/dashboards/chart-defaults';

type EChartsOption = Record<string, unknown>;

export type ChartPipelineResult =
  | { ok: true; spec: ChartDSLSpec; option: EChartsOption; repaired: boolean; attempts: number }
  | { ok: false; reason: string; attempts: number; errors: ValidationResult['errors'] };

// Reuse same client factory as agent-loop.ts
function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

// ── Repair message template (inlined TS constant) ─────────────────────────────
function buildRepairMessage(
  validationResult: ValidationResult,
  profileResult: ProfileResult,
  userIntent: string,
  queryRowCount: number,
): string {
  const errorLines = validationResult.errors.map(e =>
    `  - ${e.path || 'root'}: ${e.message}`
  ).join('\n');

  const reason = validationResult.rejectionReason ?? 'Validation failed';
  const validColumns = profileResult.profiles.map(p => `  - ${p.name} (${p.declaredType})`).join('\n');

  const VALID_KINDS = 'bar, stacked-bar, line, area, pie, scatter, heatmap, boxplot, histogram';

  return `Your previous emit_chart call was rejected. Here is the EXACT reason:

REJECTION REASON: ${reason}

ERRORS:
${errorLines || '  (none — spec was rejected at the structural level)'}

IMPORTANT NOTES:
- Valid chart kinds are: ${VALID_KINDS}
- If you used an unsupported kind (e.g. 'radar', 'funnel', 'treemap'), replace it with one from the valid list above
- columnId values MUST be exact column names from this list:
${validColumns}
- Do NOT invent column names. Copy them verbatim.

ORIGINAL REQUEST: "${userIntent}"
The result has ${queryRowCount} rows.

Please call emit_chart again with a corrected specification.`;
}

/**
 * Full chart pipeline: emit → validate+repair → compile.
 * Capped at 2 total attempts (1 initial + 1 model-assisted repair).
 * Model-assisted repair is only triggered when validateAndRepair returns rejected:true.
 */
export async function runChartPipeline(input: {
  userIntent: string;
  queryResult: QueryResult;
  profileResult: ProfileResult;
  model: string;
  sessionId: string;
}): Promise<ChartPipelineResult> {
  const { userIntent, queryResult, profileResult, model, sessionId } = input;

  // ── Attempt 1 ────────────────────────────────────────────────────────────────
  const emitResult1 = await emitChartSpec({
    userIntent,
    queryResult,
    profileResult,
    model,
    sessionId,
  });

  if ('error' in emitResult1) {
    return { ok: false, reason: emitResult1.error, attempts: 1, errors: [] };
  }

  const validation1 = validateAndRepair(emitResult1.spec, profileResult);

  if (!validation1.rejected && validation1.spec) {
    try {
      const option = compileSpecToOption(
        validation1.spec,
        profileResult,
        queryResult.rows,
        validation1.spec.themeSlot ?? 'aloft-dark',
      );
      return {
        ok: true,
        spec: validation1.spec,
        option,
        repaired: validation1.errors.some(e => e.repaired),
        attempts: 1,
      };
    } catch (compileErr: unknown) {
      const reason = compileErr instanceof Error ? compileErr.message : 'Compiler error';
      return { ok: false, reason, attempts: 1, errors: validation1.errors };
    }
  }

  // ── Attempt 2: model-assisted repair ─────────────────────────────────────────
  // Only reached if validation1.rejected === true
  const repairMessage = buildRepairMessage(
    validation1,
    profileResult,
    userIntent,
    queryResult.rows.length,
  );

  // Build conversation history: original user message + assistant's tool use + tool result + repair prompt
  const columnLines = profileResult.profiles.map(p =>
    `  - ${p.name} (${p.declaredType}, ${p.kind}, ${p.cardinality} distinct values)`
  ).join('\n');

  const systemContent = `You are a chart specification generator. Your only job is to produce a single emit_chart tool call that creates a chart from an already-returned query result.

Rules:
1. You MUST call the emit_chart tool. Do not respond with prose.
2. columnId values MUST be exact column names from the provided column list — copy them verbatim.
3. Use 'aloft-dark' as the default themeSlot for all in-app DataStudio renders.
4. Use 'aloft-light' only for export or light-surface contexts.
5. Choose the chart kind that best represents the data: bar, stacked-bar, line, area, pie, scatter, heatmap, boxplot, or histogram.
6. Assign encodings that match the column types: temporal/categorical columns to x-axis or series, numeric columns to y-axis or value.

Available columns (copy columnId values EXACTLY as shown):
${columnLines}`;

  const originalUserMsg = `${userIntent}\n\nThe result has ${queryResult.rows.length} rows.`;

  // Synthesise the raw spec from attempt 1 as if it was what the model returned
  const attempt1RawSpec = JSON.stringify(emitResult1.spec ?? emitResult1.raw);
  const syntheticToolUseId = `repair_attempt_${Date.now()}`;

  const client = getBedrockClient();

  try {
    const repairCommand = new ConverseCommand({
      modelId: model,
      system: [{ text: systemContent }],
      messages: [
        { role: 'user', content: [{ text: originalUserMsg }] },
        {
          role: 'assistant',
          content: [
            {
              toolUse: {
                toolUseId: syntheticToolUseId,
                name: 'emit_chart',
                input: emitResult1.spec as unknown as Record<string, unknown>,
              },
            } as unknown as import('@aws-sdk/client-bedrock-runtime').ContentBlock,
          ],
        },
        {
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: syntheticToolUseId,
                content: [{ text: `Rejected: ${validation1.rejectionReason ?? 'validation failed'}` }],
              },
            } as unknown as import('@aws-sdk/client-bedrock-runtime').ContentBlock,
            { text: repairMessage },
          ],
        },
      ],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'emit_chart',
              description: 'Emit a corrected chart specification.',
              inputSchema: { json: schema } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            },
          },
        ],
        toolChoice: { tool: { name: 'emit_chart' } },
      },
      inferenceConfig: { maxTokens: 1024, temperature: 0 },
    });

    const repairResponse = await client.send(repairCommand);
    const repairContent = repairResponse.output?.message?.content ?? [];

    const toolUseBlock = repairContent.find(
      (b) => 'toolUse' in (b as unknown as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    if (!toolUseBlock) {
      return {
        ok: false,
        reason: 'Model did not call emit_chart on repair attempt',
        attempts: 2,
        errors: validation1.errors,
      };
    }

    const toolUse = (toolUseBlock as { toolUse?: { name?: string; input?: unknown } }).toolUse;
    if (!toolUse || toolUse.name !== 'emit_chart') {
      return {
        ok: false,
        reason: `Expected emit_chart on repair, got: ${toolUse?.name ?? 'unknown'}`,
        attempts: 2,
        errors: validation1.errors,
      };
    }

    const rawRepaired = toolUse.input as ChartDSLSpec;
    const validation2 = validateAndRepair(rawRepaired, profileResult);

    if (!validation2.rejected && validation2.spec) {
      try {
        const option = compileSpecToOption(
          validation2.spec,
          profileResult,
          queryResult.rows,
          validation2.spec.themeSlot ?? 'aloft-dark',
        );
        return {
          ok: true,
          spec: validation2.spec,
          option,
          repaired: true,
          attempts: 2,
        };
      } catch (compileErr: unknown) {
        const reason = compileErr instanceof Error ? compileErr.message : 'Compiler error on repair';
        return { ok: false, reason, attempts: 2, errors: validation2.errors };
      }
    }

    return {
      ok: false,
      reason: validation2.rejectionReason ?? 'Validation still failed after model-assisted repair',
      attempts: 2,
      errors: validation2.errors,
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Repair attempt failed';
    return { ok: false, reason, attempts: 2, errors: validation1.errors };
  }
}

// ── Semantic chart pipeline ───────────────────────────────────────────────────

/**
 * A progressive-streaming event emitted by runSemanticChartPipeline as it moves
 * through plan → execute → render. The chat route wires onProgress to the SSE
 * emitter so the client can reveal the plan and compiled SQL before the (multi-
 * second) chart-render LLM call completes.
 */
export type SemanticProgressEvent =
  | { type: 'semantic_plan'; intent: string; definitionsSelected: string[] }
  | { type: 'semantic_sql'; compiledSQL: string }
  | { type: 'semantic_progress'; stage: 'compiling' | 'executing' | 'rendering'; message: string };

export interface SemanticChartPipelineInput {
  query: SemanticQuery;
  connectionId: string;
  model: string;
  sessionId: string;
  /** User's natural-language intent — surfaced in the semantic_plan event. */
  intent?: string;
  /** Optional progressive-streaming sink. No-op when omitted. */
  onProgress?: (event: SemanticProgressEvent) => void;
}

/** The governed definitions a semantic chart actually referenced (trust spine). */
export interface SemanticDefinitionsUsed {
  dimensions: string[];
  measures: string[];
}

export type SemanticChartPipelineResult =
  | {
      ok: true;
      sql: string;
      spec: ChartDSLSpec;
      option: EChartsOption;
      /** Trust-spine metadata (surfaced by TrustPanel in the chat card). */
      rowCount: number;
      executedAt: string;
      definitionsUsed: SemanticDefinitionsUsed;
      /** id → human label for every referenced dim/measure. */
      resolvedLabels: Record<string, string>;
      /** Smart-defaults recommendation for this query shape (informational). */
      recommendation: ChartRecommendation;
    }
  | { ok: false; reason: string; errors?: SemanticValidationError[] };

/**
 * Validate → execute → profile → chart for a SemanticQuery.
 *
 * Validation is performed before any Databricks call — invalid IDs short-circuit
 * immediately with ok:false. The model is loaded from Prisma to run validation
 * with the same ID sets that executeSemanticQuery uses.
 *
 * Safe to call from API routes: executeSemanticQuery imports server-only via
 * agents.ts, and chart-pipeline.ts runs exclusively in the server context.
 */
export async function runSemanticChartPipeline(
  input: SemanticChartPipelineInput,
): Promise<SemanticChartPipelineResult> {
  const { query, connectionId, model, sessionId, intent, onProgress } = input;
  const emitProgress = onProgress ?? (() => {});

  // ── Load model for validation ─────────────────────────────────────────────
  let modelRow: Awaited<ReturnType<typeof prisma.platform_semantic_models.findFirstOrThrow>> | null = null;
  try {
    modelRow = await prisma.platform_semantic_models.findFirstOrThrow({
      where: { id: query.modelId },
    });
  } catch {
    return { ok: false, reason: `Semantic model '${query.modelId}' not found` };
  }

  if (modelRow.status !== 'governed') {
    return { ok: false, reason: `Semantic model '${query.modelId}' is not governed (status: ${modelRow.status})` };
  }

  // Only governed/candidate (non-archived, non-draft) entities are loaded for
  // validation. Archived entities are retired; DRAFT definitions (3.5A) are
  // personal, owner-only, and must NEVER be visible to the LLM tool — this
  // path re-implements its own governance gate, so the draft exclusion must be
  // applied here as well as in execute.ts.
  const entityRows = await prisma.platform_sem_entities.findMany({
    where: { model_id: modelRow.id, status: { notIn: ['archived', 'draft'] } },
    select: { id: true },
  });

  const entityIds = entityRows.map((e) => e.id);
  // Only non-archived, non-draft definitions are valid query targets. Labels +
  // types are loaded alongside the ids the validator needs so we can build the
  // trust-spine metadata (resolved labels) and the smart-defaults
  // recommendation without a second round-trip.
  const [dimensionRows, measureRows] = await Promise.all([
    prisma.platform_sem_dimensions.findMany({ where: { entity_id: { in: entityIds }, status: { notIn: ['archived', 'draft'] } }, select: { id: true, entity_id: true, dimension_label: true, dimension_type: true } }),
    prisma.platform_sem_measures.findMany({ where: { entity_id: { in: entityIds }, status: { notIn: ['archived', 'draft'] } }, select: { id: true, entity_id: true, measure_label: true } }),
  ]);

  // ── Validate before any Databricks call ───────────────────────────────────
  const validation = validateSemanticQuery(query, {
    entities: entityRows,
    dimensions: dimensionRows,
    measures: measureRows,
  });

  if (!validation.valid) {
    return {
      ok: false,
      reason: `Semantic query validation failed: ${validation.errors.map((e) => e.reason).join('; ')}`,
      errors: validation.errors,
    };
  }

  // ── Resolve trust-spine metadata (labels + recommendation) ─────────────────
  const dimLabelById = new Map(dimensionRows.map((d) => [d.id, d.dimension_label]));
  const measureLabelById = new Map(measureRows.map((m) => [m.id, m.measure_label]));
  const dimTypeById = new Map(dimensionRows.map((d) => [d.id, d.dimension_type]));

  const definitionsUsed: SemanticDefinitionsUsed = {
    dimensions: query.dimensions.map((d) => d.dimensionId),
    measures: query.measures.map((m) => m.measureId),
  };

  const resolvedLabels: Record<string, string> = {};
  for (const d of query.dimensions) {
    resolvedLabels[d.dimensionId] = dimLabelById.get(d.dimensionId) ?? d.dimensionId;
  }
  for (const m of query.measures) {
    resolvedLabels[m.measureId] = measureLabelById.get(m.measureId) ?? m.measureId;
  }

  const resolvedDefs: ResolvedDefinitions = {
    dimensions: Object.fromEntries(
      query.dimensions.map((d) => [d.dimensionId, { id: d.dimensionId, type: dimTypeById.get(d.dimensionId) }]),
    ),
    measures: Object.fromEntries(query.measures.map((m) => [m.measureId, { id: m.measureId }])),
  };
  const recommendation = recommendChartKind(query, resolvedDefs);

  // Plan is known as soon as validation passes — surface it before execution.
  emitProgress({
    type: 'semantic_plan',
    intent: intent ?? '',
    definitionsSelected: [
      ...query.dimensions.map((d) => resolvedLabels[d.dimensionId]),
      ...query.measures.map((m) => resolvedLabels[m.measureId]),
    ],
  });

  // ── Execute ───────────────────────────────────────────────────────────────
  // NOTE: compileSemanticQuery runs inside executeSemanticQuery (we do not touch
  // its signature), so the compiled SQL is available immediately after execution
  // resolves — emitted below via semantic_sql, ahead of the chart-render step.
  emitProgress({ type: 'semantic_progress', stage: 'executing', message: 'Running query against warehouse…' });

  let execResult: Awaited<ReturnType<typeof executeSemanticQuery>>;
  try {
    execResult = await executeSemanticQuery(query, connectionId);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Semantic query execution failed';
    return { ok: false, reason };
  }

  emitProgress({ type: 'semantic_sql', compiledSQL: execResult.sql });
  emitProgress({ type: 'semantic_progress', stage: 'rendering', message: 'Building chart…' });

  // ── Build QueryResult and profile ─────────────────────────────────────────
  const queryResult: QueryResult = {
    columns: execResult.columns.map((c) => ({ name: c.name, type_name: c.type })),
    rows: execResult.rows,
    sql: execResult.sql,
    rowCount: execResult.rowCount,
    truncated: false,
  };

  const profileResult: ProfileResult = profileResultSet(queryResult.columns, queryResult.rows);

  // ── Chart ─────────────────────────────────────────────────────────────────
  const chartResult = await runChartPipeline({
    userIntent: 'chart the semantic query result',
    queryResult,
    profileResult,
    model,
    sessionId,
  });

  if (!chartResult.ok) {
    return { ok: false, reason: chartResult.reason };
  }

  return {
    ok: true,
    sql: execResult.sql,
    spec: chartResult.spec,
    option: chartResult.option,
    rowCount: execResult.rowCount,
    executedAt: new Date().toISOString(),
    definitionsUsed,
    resolvedLabels,
    recommendation,
  };
}
