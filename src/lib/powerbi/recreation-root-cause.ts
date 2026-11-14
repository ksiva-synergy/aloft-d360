/**
 * Root-cause classification for measures that are not recreated, derived from what the
 * pipeline recorded (compile / warehouse / LLM / parity outcomes) and the measure's DAX.
 * Pure — no DB access.
 */

import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { type DetectorFinding, runDetectors } from '@/lib/powerbi/recreation-detectors';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

export type RootCauseCategory =
  | 'empty_dax'
  | 'ui_slicer_helper'
  | 'text_result'
  | 'nondeterministic_source'
  | 'unsupported_dax'
  | 'harvest_gap'
  | 'replica_drift'
  | 'rls_required'
  | 'unbound_table'
  | 'pq_unsupported'
  | 'warehouse_error'
  | 'engine_limit'
  | 'warehouse_timeout'
  | 'warehouse_unavailable'
  | 'llm_failed'
  | 'data_freshness'
  | 'parity_mismatch'
  | 'parity_no_oracle'
  | 'not_translated';

export type RootCause = {
  category: RootCauseCategory;
  detail: string;
  fix: string;
  /** Detector findings with measured evidence (Phase 3). */
  evidence?: DetectorFinding[];
  /** The cause names a specific, actionable defect (not just a stage that failed). */
  precise?: boolean;
};

/** Categories that only say which stage failed; precise only when a detector names the pattern. */
const GENERIC: ReadonlySet<RootCauseCategory> = new Set([
  'parity_mismatch',
  'warehouse_error',
  'unsupported_dax',
  'pq_unsupported',
  'llm_failed',
  'not_translated',
  'parity_no_oracle',
]);
const NAMING_DETECTORS = new Set([
  'pq_capability_gap',
  'dax_capability_gap',
  'scale_mismatch',
  'sign_flip',
  'row_fanout',
  'empty_sql_result',
  'blank_mismatch',
  'boundary_rows',
  'type_mismatch',
  'compiler_blowup',
]);

const FIX: Record<RootCauseCategory, string> = {
  empty_dax: 'Measure body is empty or fully commented out in Power BI — retire it or restore the DAX.',
  ui_slicer_helper:
    'Visual filter helper (SELECTEDVALUE over a static DATATABLE slicer); returns 1/0 per visual row — not a reportable number. Exclude from recreation.',
  text_result:
    'Measure returns text (label / formatted string); parity compares numbers. Recreate the underlying numeric measure, or add text-aware parity.',
  nondeterministic_source:
    "Power BI's own value depends on source row order (keyed Table.Distinct). Add a sort before Table.Distinct in Power Query or agree a deterministic rule with the steward.",
  unsupported_dax: 'DAX construct not yet modeled by the compiler — extend dax-sql-compile.ts for it.',
  harvest_gap: 'Harvested model is incomplete for this measure — re-run pbi_definitions + pbi_parse (force_parse).',
  rls_required:
    'The Power BI model enforces row-level security, so the oracle cannot read a value with the service principal. Configure an RLS test identity (effective identity) for the oracle, then re-run pbi_oracle + pbi_parity.',
  replica_drift:
    'The warehouse replica schema differs from the source Power BI reads (column missing, renamed or split). Caught by the fidelity gate before compile — confirm the mapping with the data steward or fix the replica, then re-run pbi_translate.',
  unbound_table: 'A referenced table has no warehouse binding — bind it in pbi_catalog_link (steward) or model it.',
  pq_unsupported: 'Power Query step not modeled in m-lineage.ts — extend lineage for it.',
  warehouse_error: 'Compiled SQL failed on Databricks with no grounded auto-repair — see attempts in expand_failure.',
  warehouse_timeout:
    'Query is valid but exceeded its time budget (PBI_EXEC_EXPLAIN_BUDGET_MS / PBI_EXEC_EXECUTE_BUDGET_MS). Check telemetry for SQL size/growth; raise the budget or reduce the plan.',
  warehouse_unavailable:
    'Warehouse or network was unavailable after retries (503 / connection). Not a SQL defect — the next run retries it automatically.',
  engine_limit:
    'SQL is logically complete but Databricks cannot plan it: a per-value iterator (SUMX/FILTER over VALUES) calls a measure whose own CALCULATE/FILTER logic nests correlated subqueries 2+ levels deep (Spark INTERNAL_ERROR / timeout). Needs decorrelated SQL (evaluate the measure per value with GROUP BY / joins) in the compiler.',
  llm_failed: 'Compiler and LLM both failed — see expand_failure / llm_failure.',
  data_freshness:
    'Power BI dataset is older than the warehouse data this SQL read (the warehouse value is more recent than the snapshot). Refresh the dataset, then re-run pbi_oracle + pbi_parity.',
  parity_mismatch: 'SQL runs but differs from the Power BI oracle — compare filters / lineage notes.',
  parity_no_oracle: 'No numeric oracle value for this measure — run pbi_oracle or check the measure returns a number.',
  not_translated: 'No translation row — run pbi_translate.',
};

function stripDaxComments(dax: string): string {
  return dax.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(\/\/|--).*$/gm, '').trim();
}

/** Dates found in a parity value: ISO date/datetime or "13 Nov 2026"-style text. */
export function datesInValue(v: unknown): { at: number; dayOnly: boolean }[] {
  if (typeof v !== 'string') return [];
  const out: { at: number; dayOnly: boolean }[] = [];
  const re =
    /\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?\b|\b(\d{1,2} [A-Za-z]{3,9} \d{4})\b/g;
  for (const m of v.matchAll(re)) {
    const text = m[1] ? `${m[1]}T${m[2] ?? '00:00:00'}Z` : `${m[3]} UTC`;
    const at = Date.parse(text);
    if (Number.isFinite(at)) out.push({ at, dayOnly: !m[2] });
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Likely stale dataset: the warehouse value carries a later date than the Power BI value, the
 * Power BI value is not newer than its own last refresh, and the check ran after that refresh —
 * i.e. rows reached the warehouse after the snapshot (including back-dated records).
 */
export function isFreshnessGap(parity: Record<string, unknown> | null): boolean {
  const refreshedRaw = parity?.model_refresh_at;
  if (typeof refreshedRaw !== 'string') return false;
  const refreshed = Date.parse(refreshedRaw);
  if (!Number.isFinite(refreshed)) return false;
  const checked = typeof parity?.checked_at === 'string' ? Date.parse(parity.checked_at) : Date.now();
  if (!(checked > refreshed)) return false;
  const latest = (ds: { at: number }[]) => (ds.length ? Math.max(...ds.map((d) => d.at)) : null);
  const sqlLatest = latest(datesInValue(parity?.sql_value));
  const oracleLatest = latest(datesInValue(parity?.oracle_value));
  if (sqlLatest === null || oracleLatest === null) return false;
  return sqlLatest > oracleLatest && oracleLatest <= refreshed + DAY_MS && sqlLatest <= checked + DAY_MS;
}

function rc(category: RootCauseCategory, detail: string): RootCause {
  return { category, detail, fix: FIX[category] };
}

/** Genuine Spark planner/executor failures (timeouts and cancellations are classified separately). */
const ENGINE_LIMIT_RE = /INTERNAL_ERROR|STAGE_MATERIALIZATION|outerScope\(/i;

/**
 * Visual-filter helper: returns 1/0 for whether the current row matches a slicer selection
 * (SELECTEDVALUE over a static DATATABLE) and does not aggregate anything itself. Counts such
 * as SUMX(VALUES(…), IF([Status] = SELECTEDVALUE(…), 1, 0)) are real KPIs, not helpers.
 */
function readsStaticSlicer(dax: string, catalog: MeasureLogicCatalog | null): boolean {
  if (!catalog) return false;
  if (/\b(SUMX|COUNTX|AVERAGEX|COUNTROWS|DISTINCTCOUNT|SUM|COUNT)\s*\(/i.test(dax)) return false;
  for (const m of dax.matchAll(/SELECTEDVALUE\s*\(\s*(?:'([^']+)'|([\w]+))\s*\[/gi)) {
    const key = normalizePbiTableName(m[1] ?? m[2] ?? '').toLowerCase();
    const src = catalog.tableMeta.get(key)?.source_m?.replace(/^calculated\s+source\s*=\s*/i, '').trim() ?? '';
    if (/^DATATABLE\s*\(/i.test(src)) return true;
  }
  return false;
}

export function classifyRootCause(input: {
  stage: string;
  dax: string;
  tier: string | null;
  props: Record<string, unknown> | null;
  catalog: MeasureLogicCatalog | null;
}): RootCause | null {
  const base = classifyBase(input);
  if (!base) return null;
  const evidence = runDetectors(input.props);
  const investigated = Boolean((input.props?.investigation as { first_difference?: unknown } | undefined)?.first_difference);
  const precise =
    !GENERIC.has(base.category) || investigated || evidence.some((f) => NAMING_DETECTORS.has(f.detector));
  return { ...base, ...(evidence.length ? { evidence } : {}), precise };
}

function classifyBase(input: {
  stage: string;
  dax: string;
  tier: string | null;
  props: Record<string, unknown> | null;
  catalog: MeasureLogicCatalog | null;
}): RootCause | null {
  const { stage, props } = input;
  if (stage === 'recreated' || stage === 'published') return null;

  const dax = stripDaxComments(input.dax ?? '');
  if (!dax) return rc('empty_dax', 'DAX is empty after removing comments');

  const spec = (props?.expand_spec ?? null) as Record<string, unknown> | null;
  const warnings = Array.isArray(spec?.warnings) ? (spec!.warnings as string[]) : [];
  const parity = (props?.parity ?? null) as Record<string, unknown> | null;
  const paritySummary = typeof parity?.summary === 'string' ? parity.summary : '';

  if (stage === 'parity_fail') {
    if (warnings.length) return rc('nondeterministic_source', warnings[0]!);
    if (isFreshnessGap(parity)) {
      return rc(
        'data_freshness',
        `${paritySummary} — likely: warehouse has newer rows than the dataset refreshed ${String(parity?.model_refresh_at)}`,
      );
    }
    const inv = (props?.investigation ?? null) as { first_difference?: unknown; conclusion?: string } | null;
    if (inv?.first_difference && inv.conclusion) return rc('parity_mismatch', `${inv.conclusion} · ${paritySummary}`);
    return rc('parity_mismatch', paritySummary);
  }
  if (stage === 'parity_skip' || stage === 'parity_error' || stage === 'draft_sql') {
    if (parity?.no_oracle_reason === 'rls') return rc('rls_required', paritySummary);
    if (parity?.exec_outcome === 'timeout') return rc('warehouse_timeout', paritySummary);
    if (parity?.exec_outcome === 'transient') return rc('warehouse_unavailable', paritySummary);
    if (spec?.result_kind === 'string') return rc('text_result', paritySummary || 'Measure returns text');
    return rc(stage === 'parity_error' ? 'warehouse_error' : 'parity_no_oracle', paritySummary || stage);
  }

  // no_sql / no_uc
  const fb = (props?.fidelity_block ?? null) as { reason?: string; issues?: { kind?: string }[] } | null;
  if (fb) {
    const kinds = new Set((fb.issues ?? []).map((i) => i.kind));
    const detail = String(fb.reason ?? '').slice(0, 300);
    if (kinds.has('replica_drift')) return rc('replica_drift', detail);
    if (kinds.has('empty_measure')) return rc('empty_dax', detail);
    return rc('harvest_gap', detail);
  }
  const efEarly = (props?.expand_failure ?? null) as Record<string, unknown> | null;
  if (efEarly?.warehouse_outcome === 'timeout') return rc('warehouse_timeout', String(efEarly.reason ?? '').slice(0, 300));
  if (efEarly?.warehouse_outcome === 'transient') {
    return rc('warehouse_unavailable', String(efEarly.reason ?? '').slice(0, 300));
  }
  if (efEarly?.stage === 'warehouse' && typeof efEarly.reason === 'string' && ENGINE_LIMIT_RE.test(efEarly.reason)) {
    return rc('engine_limit', efEarly.reason.slice(0, 300));
  }
  if (readsStaticSlicer(dax, input.catalog)) {
    return rc('ui_slicer_helper', 'SELECTEDVALUE over a DATATABLE slicer table');
  }
  const ef = (props?.expand_failure ?? null) as Record<string, unknown> | null;
  const reason = typeof ef?.reason === 'string' ? ef.reason : '';
  if (ef) {
    if (ef.stage === 'warehouse') return rc('warehouse_error', reason);
    if (/no Unity Catalog binding/i.test(reason)) return rc('unbound_table', reason);
    if (/Power Query steps? .*not modeled|Power Query (column|transform)/i.test(reason)) {
      return rc('pq_unsupported', reason);
    }
    if (/harvest|not in the harvested model|lost its DAX|Cannot parse/i.test(reason)) {
      return rc('harvest_gap', reason);
    }
    return rc('unsupported_dax', reason);
  }
  const lf = (props?.llm_failure ?? null) as Record<string, unknown> | null;
  if (lf) return rc('llm_failed', typeof lf.reason === 'string' ? lf.reason : 'LLM failed');
  if (!input.tier) return rc('not_translated', 'No translation row');
  const logic = props?.measure_logic_analysis as Record<string, unknown> | undefined;
  return rc('unsupported_dax', typeof logic?.block_reason === 'string' ? logic.block_reason : `tier=${input.tier}`);
}
