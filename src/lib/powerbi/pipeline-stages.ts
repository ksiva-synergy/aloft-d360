/**
 * Power BI recreation pipeline stages for the "Run pipeline" control: which stages exist, which
 * stages must run together, and the Power BI scope that every chained stage must keep. Pure.
 */

export type PbiStageId = 'definitions' | 'parse' | 'catalog_link' | 'translate' | 'oracle' | 'parity' | 'publish';

export type PbiStage = {
  id: PbiStageId;
  /** Orchestrator job kind. */
  kind: string;
  label: string;
  hint: string;
  /** Stages that must run with this one (after it), and why. */
  requires: { stage: PbiStageId; why: string }[];
};

/** In run order. */
export const PBI_STAGES: PbiStage[] = [
  {
    id: 'definitions',
    kind: 'pbi_definitions',
    label: 'Definitions',
    hint: 'Fetch the model definition (TMDL) and report definitions from Power BI',
    requires: [{ stage: 'parse', why: 'new definitions must be parsed' }],
  },
  {
    id: 'parse',
    kind: 'pbi_parse',
    label: 'Parse',
    hint: 'Load tables, columns, measures and relationships into the estate',
    requires: [
      { stage: 'catalog_link', why: 'tables may have changed — re-bind them to the warehouse' },
      { stage: 'translate', why: 'measures may have changed — recompile them' },
    ],
  },
  {
    id: 'catalog_link',
    kind: 'pbi_catalog_link',
    label: 'Catalog link',
    hint: 'Bind Power BI tables to Unity Catalog objects',
    requires: [{ stage: 'translate', why: 'new bindings change the generated SQL' }],
  },
  {
    id: 'translate',
    kind: 'pbi_translate',
    label: 'Translate',
    hint: 'Compile DAX to Databricks SQL (fidelity gate, compiler, rules, LLM fallback); only changed measures',
    requires: [
      { stage: 'oracle', why: 'recompiled measures need fresh Power BI values' },
      { stage: 'parity', why: 'recompiled SQL clears verdicts — it must be compared again' },
    ],
  },
  {
    id: 'oracle',
    kind: 'pbi_oracle',
    label: 'Power BI values',
    hint: 'Read each translated measure’s value from Power BI (RLS models through the Arrow API)',
    requires: [{ stage: 'parity', why: 'new Power BI values must be compared' }],
  },
  {
    id: 'parity',
    kind: 'pbi_parity',
    label: 'Compare',
    hint: 'Run the SQL and compare with Power BI (total and per member)',
    requires: [],
  },
  {
    id: 'publish',
    kind: 'pbi_publish',
    label: 'Publish',
    hint: 'Publish matching measures as verified queries; demote regressions (RLS models are held)',
    requires: [],
  },
];

const BY_ID = new Map(PBI_STAGES.map((s) => [s.id, s]));

/**
 * Stages that run when `chosen` are picked: the chosen ones plus everything they require
 * (transitively), in run order. `reasons` explains each automatically added stage.
 */
export function resolveStages(chosen: PbiStageId[]): {
  stages: PbiStageId[];
  reasons: Partial<Record<PbiStageId, string>>;
} {
  const selected = new Set<PbiStageId>(chosen);
  const reasons: Partial<Record<PbiStageId, string>> = {};
  const queue = [...chosen];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of BY_ID.get(id)?.requires ?? []) {
      if (selected.has(r.stage)) continue;
      selected.add(r.stage);
      reasons[r.stage] = `added with ${BY_ID.get(id)!.label}: ${r.why}`;
      queue.push(r.stage);
    }
  }
  return { stages: PBI_STAGES.filter((s) => selected.has(s.id)).map((s) => s.id), reasons };
}

/** Stages that cannot be unticked because a ticked stage requires them. */
export function lockedStages(chosen: PbiStageId[]): Set<PbiStageId> {
  const { stages } = resolveStages(chosen);
  const explicit = new Set(chosen);
  return new Set(stages.filter((s) => !explicit.has(s)));
}

/** Job kinds in run order for the launch API. */
export function stageKinds(chosen: PbiStageId[]): string[] {
  return resolveStages(chosen).stages.map((s) => BY_ID.get(s)!.kind);
}

/**
 * Scope fields every stage of a chained Power BI run must keep — without them a chained stage
 * runs across ALL models (bug found 2026-11-15: the chain rebuilt child scopes without model_ids).
 */
export const PBI_CHAIN_SCOPE_KEYS = [
  'model_ids',
  'report_ids',
  'fetch_models',
  'fetch_reports',
  'force_parse',
  'oracle_only_translated',
  'llm_translate',
  'max_llm_measures',
  'force_translate',
] as const;

export function copyPbiScope(from: Record<string, unknown>, onto: Record<string, unknown>): Record<string, unknown> {
  for (const k of PBI_CHAIN_SCOPE_KEYS) if (from[k] !== undefined) onto[k] = from[k];
  return onto;
}
