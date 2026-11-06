import 'server-only';
import { z } from 'zod';
import { harvestLlmComplete } from '../harvest-llm';
import type { ObjectT2Context } from './object-t2-context';
import type { ClusterProposal, TableProposal } from './proposal-types';

const ClusterLlmSchema = z.object({
  entities: z.array(
    z.object({
      full_path: z.string(),
      entity_label: z.string(),
      description: z.string().nullable().optional(),
    }),
  ),
  joins: z.array(
    z.object({
      from_path: z.string(),
      to_path: z.string(),
      join_on_sql: z.string(),
      description: z.string().nullable().optional(),
    }),
  ),
});

const TableLlmSchema = z.object({
  dimensions: z.array(
    z.object({
      column_name: z.string(),
      dimension_label: z.string(),
      dimension_type: z.string(),
    }),
  ),
  measures: z.array(
    z.object({
      column_name: z.string(),
      measure_label: z.string(),
      aggregate: z.string(),
      metric_type: z.string().optional(),
    }),
  ),
});

function compactTablePayload(ctx: ObjectT2Context): Record<string, unknown> {
  return {
    full_path: ctx.full_path,
    card: ctx.card,
    columns: ctx.columns.map(c => ({
      name: c.name,
      data_type: c.data_type,
      semantic: c.semantic,
    })),
  };
}

/**
 * Approximates legacy aloft-platform T4 entity-propose: one LLM call per schema cluster.
 */
export async function llmClusterProposal(
  contexts: ObjectT2Context[],
  catalog: string,
  schema: string,
): Promise<ClusterProposal> {
  const userMessage = [
    `Propose semantic entities and joins for catalog.schema = ${catalog}.${schema}.`,
    'Return ONLY JSON: {"entities":[{full_path,entity_label,description}], "joins":[{from_path,to_path,join_on_sql,description}]}',
    'Use full_path exactly as given. joins may infer relationships not only from fk_candidates.',
    '',
    JSON.stringify({ tables: contexts.map(compactTablePayload) }, null, 2),
  ].join('\n');

  const resp = await harvestLlmComplete({
    system:
      'You are a semantic model bootstrap engine for a metrics catalog. Output strict JSON only, no markdown.',
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
  });

  const parsed = ClusterLlmSchema.parse(JSON.parse(extractJson(resp.text)));
  return parsed;
}

/**
 * Approximates legacy per-table dim/measure propose.
 */
export async function llmTableProposal(ctx: ObjectT2Context): Promise<TableProposal> {
  const userMessage = [
    `Propose dimensions and measures for table ${ctx.full_path}.`,
    'Return ONLY JSON: {"dimensions":[{column_name,dimension_label,dimension_type}],"measures":[{column_name,measure_label,aggregate,metric_type}]}',
    '',
    JSON.stringify(compactTablePayload(ctx), null, 2),
  ].join('\n');

  const resp = await harvestLlmComplete({
    system:
      'You are a semantic model bootstrap engine. Classify columns into dimensions and measures. Output strict JSON only.',
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
  });

  const parsed = TableLlmSchema.parse(JSON.parse(extractJson(resp.text)));
  return {
    full_path: ctx.full_path,
    dimensions: parsed.dimensions,
    measures: parsed.measures.map(m => ({ ...m, metric_type: m.metric_type ?? 'simple' })),
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
