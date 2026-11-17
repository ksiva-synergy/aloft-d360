/**
 * Compact per-report facts from stored lineage snapshots, for the all-reports hub: where each
 * report's data comes from (by origin class), Unity Catalog coverage, and the saved questions
 * engineers filter by. Pure — the SQL that extracts the facts lives in report-lineage-snapshot-load.
 */

import { originClass, type OriginClass, type OriginSystem } from '@/lib/powerbi/source-origin';

export type SnapshotTableFacts = { systems: string[]; kind: string | null; uc: boolean };

export type LineageQuestionId = 'file' | 'unbound' | 'unknown' | 'blocked';

export const LINEAGE_QUESTIONS: { id: LineageQuestionId; label: string }[] = [
  { id: 'file', label: 'Reads Excel, CSV, SharePoint or web files' },
  { id: 'unbound', label: 'Has warehouse tables not mapped to Unity Catalog' },
  { id: 'unknown', label: 'Has sources we could not trace' },
  { id: 'blocked', label: 'Blocked or failed (no usable lineage)' },
];

export function isLineageQuestion(value: string | null | undefined): value is LineageQuestionId {
  return LINEAGE_QUESTIONS.some((question) => question.id === value);
}

export type SnapshotSummary = {
  status: string;
  generated_at: string;
  warning_count: number;
  tables: number;
  mix: Record<OriginClass, number>;
  uc_bound: number;
  uc_candidates: number;
};

const emptyMix = (): Record<OriginClass, number> => ({ warehouse: 0, database: 0, file: 0, model: 0, unknown: 0 });

function factsClass(systems: string[]): OriginClass {
  const classes = systems.map((system) => originClass({ system: system as OriginSystem }));
  return classes.find((cls) => cls !== 'unknown') ?? 'unknown';
}

export function summarizeSnapshot(input: {
  status: string;
  generated_at: Date | string;
  warning_count: number | bigint | null;
  tables: unknown;
}): SnapshotSummary {
  const tables = Array.isArray(input.tables) ? input.tables as SnapshotTableFacts[] : [];
  const mix = emptyMix();
  let ucBound = 0;
  let ucCandidates = 0;
  for (const table of tables) {
    mix[factsClass(Array.isArray(table?.systems) ? table.systems.filter((s): s is string => typeof s === 'string') : [])] += 1;
    if (table?.uc) ucBound += 1;
    if (table?.uc || table?.kind === 'warehouse_query') ucCandidates += 1;
  }
  return {
    status: input.status,
    generated_at: input.generated_at instanceof Date ? input.generated_at.toISOString() : String(input.generated_at),
    warning_count: Number(input.warning_count ?? 0),
    tables: tables.length,
    mix,
    uc_bound: ucBound,
    uc_candidates: ucCandidates,
  };
}

export function matchesQuestion(summary: SnapshotSummary, question: LineageQuestionId): boolean {
  switch (question) {
    case 'file': return summary.mix.file > 0;
    case 'unbound': return summary.uc_candidates > summary.uc_bound;
    case 'unknown': return summary.mix.unknown > 0;
    case 'blocked': return summary.status === 'blocked' || summary.status === 'failed';
  }
}

/** Estate-wide totals: tables per origin class and reports per saved question. */
export function summarizeEstate(summaries: Iterable<SnapshotSummary>) {
  const classes = emptyMix();
  const questions: Record<LineageQuestionId, number> = { file: 0, unbound: 0, unknown: 0, blocked: 0 };
  for (const summary of summaries) {
    for (const cls of Object.keys(classes) as OriginClass[]) classes[cls] += summary.mix[cls];
    for (const question of LINEAGE_QUESTIONS) if (matchesQuestion(summary, question.id)) questions[question.id] += 1;
  }
  return { classes, questions };
}
