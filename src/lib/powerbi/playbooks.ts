/**
 * Playbooks (Architecture v2, Phase 4): the lessons learned while recreating Power BI measures,
 * as data the pipeline can act on. Each playbook says when it applies (trigger), how to confirm
 * the diagnosis, what fixes it and who acts. Detectors and root causes name the symptom; the LLM
 * investigator receives the matching playbooks as context; confirmed new diagnoses become new
 * playbooks (via a reviewed change). Mirrors .claude/skills/pbi-recreation/SKILL.md. Pure.
 */

import type { ProbeKind } from '@/lib/powerbi/decompose-plan';
import type { DetectorName } from '@/lib/powerbi/recreation-detectors';
import type { RootCauseCategory } from '@/lib/powerbi/recreation-root-cause';

export type FixKind = 'rule' | 'compiler' | 'steward' | 'owner' | 'none';

export type Playbook = {
  id: string;
  title: string;
  trigger: {
    rootCauses?: RootCauseCategory[];
    detectors?: DetectorName[];
    /** Regex source matched against the stored error / failure reason. */
    errorPattern?: string;
    /** Kind of the first differing decomposition probe. */
    firstDifference?: ProbeKind[];
  };
  /** Steps that confirm the diagnosis. */
  confirm: string[];
  fix: { kind: FixKind; action: string };
  /** How the fix is proven. */
  verify: string;
};

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: 'replica-drift',
    title: 'Replica schema drift',
    trigger: { rootCauses: ['replica_drift'], errorPattern: 'UNRESOLVED_COLUMN' },
    confirm: [
      'Fidelity report lists the Power Query input column missing from the bound warehouse object',
      'Check for a split (X_OR_Y → X, Y) or rename suggestion',
    ],
    fix: { kind: 'steward', action: 'Data steward confirms the column mapping or fixes the replica; never guess in SQL' },
    verify: 'Fidelity gate clears; measure compiles; parity passes',
  },
  {
    id: 'rls',
    title: 'Row-level security model',
    trigger: { rootCauses: ['rls_required'] },
    confirm: ['Model rls_required; executeQueries returns 401 for the service principal'],
    fix: { kind: 'none', action: 'Oracle reads through executeDaxQueries (Arrow) with a workspace-Admin service principal; publishing waits for RLS-aware publishing' },
    verify: 'Oracle writes a value; parity compares',
  },
  {
    id: 'stale-dataset',
    title: 'Dataset older than the warehouse',
    trigger: { rootCauses: ['data_freshness'], detectors: ['boundary_rows'], firstDifference: ['row_count'] },
    confirm: [
      'Row count in SQL > Power BI for a table in the closure',
      'Ownership card: last successful refresh is older than the newest warehouse rows, or the refresh failed',
    ],
    fix: { kind: 'owner', action: 'Report owner refreshes / repairs the dataset refresh' },
    verify: 'After refresh, oracle + parity pass without SQL changes',
  },
  {
    id: 'pq-gap',
    title: 'Power Query step not modeled',
    trigger: { rootCauses: ['pq_unsupported'], detectors: ['pq_capability_gap'] },
    confirm: ['expand_failure.gap kind m_step / m_fn names the step'],
    fix: { kind: 'compiler', action: 'Model the step in m-lineage.ts generically (the LLM cannot see Power Query; do not write around it)' },
    verify: 'Unit test with a synthetic M source; affected measures compile; golden check OK; parity passes',
  },
  {
    id: 'dax-fn-gap',
    title: 'DAX function not modeled',
    trigger: { rootCauses: ['unsupported_dax'], detectors: ['dax_capability_gap'], errorPattern: 'DAX function \\S+ not supported' },
    confirm: ['expand_failure.gap kind dax_fn names the function and arity'],
    fix: { kind: 'rule', action: 'Synthesize a registry rule (LLM) and prove it with the Power BI differential harness' },
    verify: 'Differential test passes on generated edge cases; measure compiles; parity passes',
  },
  {
    id: 'row-transition',
    title: 'CALCULATE on the current row',
    trigger: { errorPattern: 'context transition on the current row' },
    confirm: ['Calculated column or iterator calls CALCULATE / a measure over its own table'],
    fix: { kind: 'compiler', action: 'Key filter on a unique key, else row identity hash (ROW_HASH) — already modeled; a remaining case is a new compiler gap' },
    verify: 'Measure matches Power BI; golden check OK',
  },
  {
    id: 'plan-blowup',
    title: 'Generated SQL too large / slow to plan',
    trigger: { rootCauses: ['warehouse_timeout'], detectors: ['compiler_blowup', 'slow_plan'] },
    confirm: ['telemetry sql_chars / growth / ctes high; explain time near the budget'],
    fix: { kind: 'compiler', action: 'Share uncorrelated scalars, linear BLANK sums, grouped evaluation for per-value iterators' },
    verify: 'SQL shrinks; executes within budget; golden check OK',
  },
  {
    id: 'spark-correlation',
    title: 'Spark cannot plan correlated subqueries',
    trigger: { rootCauses: ['engine_limit'], errorPattern: 'INTERNAL_ERROR|MUST_AGGREGATE_CORRELATED_SCALAR_SUBQUERY|PHOTON_EXPR_COMPILATION_FAILED' },
    confirm: ['Per-value iterator (SUMX / FILTER over VALUES or a dimension) calls measures with their own filters'],
    fix: { kind: 'compiler', action: 'Decorrelate: grouped CTE joined into the iterator; correlated scalar subqueries must be aggregated' },
    verify: 'Executes; matches Power BI; golden check OK',
  },
  {
    id: 'cast-error',
    title: 'Text value in a numeric column',
    trigger: { detectors: ['cast_error'], errorPattern: 'cannot be cast to' },
    confirm: ['Databricks names the offending value and type'],
    fix: { kind: 'steward', action: 'Clean the source column, or agree a TRY_CAST rule for it' },
    verify: 'Parity passes',
  },
  {
    id: 'scale-sign-fanout',
    title: 'Systematic value difference',
    trigger: { detectors: ['scale_mismatch', 'sign_flip', 'row_fanout'] },
    confirm: ['Ratio SQL / Power BI is ×100, ×1000, −1 or an exact integer'],
    fix: { kind: 'compiler', action: 'Units / subtraction order / non-unique join key (relationship cardinality) — fix the compiler path, not the measure' },
    verify: 'Parity passes; golden check OK',
  },
  {
    id: 'blank-row',
    title: 'Relationship blank row / orphan keys',
    trigger: { firstDifference: ['distinct_values'] },
    confirm: ['Distinct key count differs by one (blank row) or by the number of orphan keys'],
    fix: { kind: 'compiler', action: 'VALUES / ALL include the blank row only when many-side orphans exist and no filter is on the table' },
    verify: 'Distinct probe matches; parity passes',
  },
];

export type PlaybookMatchInput = {
  rootCause?: string | null;
  detectors?: string[];
  errorText?: string | null;
  firstDifference?: string | null;
};

/** Playbooks whose trigger matches, strongest evidence first. */
export function matchPlaybooks(input: PlaybookMatchInput, playbooks: Playbook[] = BUILTIN_PLAYBOOKS): Playbook[] {
  const scored = playbooks
    .map((p) => {
      let score = 0;
      if (input.rootCause && p.trigger.rootCauses?.includes(input.rootCause as RootCauseCategory)) score += 3;
      if (input.detectors?.some((d) => p.trigger.detectors?.includes(d as DetectorName))) score += 2;
      if (input.errorText && p.trigger.errorPattern && new RegExp(p.trigger.errorPattern, 'i').test(input.errorText)) {
        score += 2;
      }
      if (input.firstDifference && p.trigger.firstDifference?.includes(input.firstDifference as ProbeKind)) score += 2;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.p);
}
