import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { ChartDSLSpec } from '@/lib/studio/types';
import type { ProfileResult } from '@/lib/studio/types';
import type { QueryResult } from '@/hooks/useInspectorChat';
import schema from '../../lib/studio/chart-dsl.schema.json';

// Reuse the same BedrockRuntimeClient factory used by agent-loop.ts (line 62).
// NOT exported — chart-emitter must use the same credentials/region.
function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

// ── System prompt (inlined TS constant — never readFile) ──────────────────────
const CHART_EMITTER_SYSTEM_PROMPT = `You are a chart specification generator. Your only job is to produce a single emit_chart tool call that creates a chart from an already-returned query result.

Rules:
1. You MUST call the emit_chart tool. Do not respond with prose.
2. columnId values MUST be exact column names from the provided column list — copy them verbatim.
3. Use 'aloft-dark' as the default themeSlot for all in-app DataStudio renders.
4. Use 'aloft-light' only for export or light-surface contexts.
5. Choose the chart kind that best represents the data: bar, stacked-bar, line, area, pie, scatter, heatmap, boxplot, or histogram.
6. Assign encodings that match the column types: temporal/categorical columns to x-axis or series, numeric columns to y-axis or value.`;

// Build a column description line for the system message context.
function describeColumn(p: ProfileResult['profiles'][number]): string {
  const card = p.cardinality > 0 ? `${p.cardinality} distinct values` : 'unknown cardinality';
  return `  - ${p.name} (${p.declaredType}, ${p.kind}, ${card})`;
}

export interface ChartEmitterInput {
  userIntent: string;
  queryResult: QueryResult;
  profileResult: ProfileResult;
  model: string;
  sessionId: string;
}

export type ChartEmitterResult =
  | { spec: ChartDSLSpec; raw: unknown }
  | { error: string; raw: unknown };

/**
 * Dedicated NON-STREAMING ConverseCommand call that forces emit_chart tool use.
 * Separate from the main agent loop (which uses ConverseStreamCommand) because
 * toolChoice cannot be mixed into the streaming loop without changing its behaviour
 * for all turns.
 */
export async function emitChartSpec(input: ChartEmitterInput): Promise<ChartEmitterResult> {
  const { userIntent, queryResult, profileResult, model, sessionId: _sessionId } = input;

  const columnLines = profileResult.profiles.map(describeColumn).join('\n');
  const systemContent = `${CHART_EMITTER_SYSTEM_PROMPT}

Available columns (copy columnId values EXACTLY as shown):
${columnLines}`;

  const userContent = `${userIntent}

The result has ${queryResult.rows.length} rows.`;

  const client = getBedrockClient();

  try {
    const command = new ConverseCommand({
      modelId: model,
      system: [{ text: systemContent }],
      messages: [{ role: 'user', content: [{ text: userContent }] }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'emit_chart',
              description: 'Emit a typed chart specification from the query result.',
              inputSchema: {
                json: schema,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            },
          },
        ],
        toolChoice: { tool: { name: 'emit_chart' } },
      },
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0,
      },
    });

    const response = await client.send(command);

    // Extract the tool_use block from output.output.message.content
    const content = response.output?.message?.content ?? [];
    const toolUseBlock = content.find(
      (b) => 'toolUse' in (b as unknown as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    if (!toolUseBlock) {
      return { error: 'Model did not call emit_chart — no tool_use block in response', raw: response };
    }

    const toolUse = toolUseBlock.toolUse as { name?: string; input?: unknown } | undefined;
    if (!toolUse || toolUse.name !== 'emit_chart') {
      return { error: `Expected emit_chart tool call, got: ${toolUse?.name ?? 'unknown'}`, raw: toolUse };
    }

    const rawInput = toolUse.input as ChartDSLSpec;
    return { spec: rawInput, raw: rawInput };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'emitChartSpec failed';
    return { error: msg, raw: err };
  }
}
