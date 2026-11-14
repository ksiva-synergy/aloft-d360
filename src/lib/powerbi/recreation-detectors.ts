/**
 * L5 detectors (Architecture v2, Phase 3): name the failure pattern from what the pipeline
 * recorded — telemetry, compile/warehouse outcomes, parity values — with the evidence.
 * Pure: no DB, no warehouse. Feeds the root-cause classifier and the Estate cards.
 */

export type DetectorName =
  | 'compiler_blowup'
  | 'slow_plan'
  | 'validation_deferred'
  | 'pq_capability_gap'
  | 'dax_capability_gap'
  | 'scale_mismatch'
  | 'sign_flip'
  | 'row_fanout'
  | 'empty_sql_result'
  | 'blank_mismatch'
  | 'boundary_rows'
  | 'type_mismatch'
  | 'cast_error';

export type DetectorFinding = {
  detector: DetectorName;
  /** One sentence with the measured evidence. */
  evidence: string;
  /** What to do about it. */
  action: string;
};

type Props = Record<string, unknown> | null | undefined;

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

/** Thresholds (generated SQL vs DAX size) above which Databricks planning gets slow. */
export const BLOWUP = { sqlChars: 12_000, growth: 25, ctes: 30 };
export const SLOW_PLAN_MS = 60_000;

export function runDetectors(props: Props): DetectorFinding[] {
  const out: DetectorFinding[] = [];
  const tel = (props?.telemetry ?? null) as Record<string, unknown> | null;
  const ef = (props?.expand_failure ?? null) as Record<string, unknown> | null;
  const test = (props?.expand_test ?? null) as Record<string, unknown> | null;
  const parity = (props?.parity ?? null) as Record<string, unknown> | null;

  // ── size / planning ────────────────────────────────────────────────────────
  const sqlChars = num(tel?.sql_chars) ?? 0;
  const growth = num(tel?.growth) ?? 0;
  const ctes = num(tel?.ctes) ?? 0;
  if (sqlChars >= BLOWUP.sqlChars || growth >= BLOWUP.growth || ctes >= BLOWUP.ctes) {
    out.push({
      detector: 'compiler_blowup',
      evidence: `Generated SQL is ${fmt(sqlChars)} chars (${growth}× the DAX) with ${ctes} CTEs`,
      action: 'Shared sub-results are being repeated — share them as CTEs (compiler) or decorrelate the per-value iterator.',
    });
  }
  const testMs = num(tel?.test_ms) ?? 0;
  if (testMs >= SLOW_PLAN_MS || tel?.outcome === 'timeout') {
    out.push({
      detector: 'slow_plan',
      evidence: `Databricks spent ${Math.round(testMs / 1000)} s planning the query${tel?.outcome === 'timeout' ? ' and ran out of budget' : ''}`,
      action: 'Reduce the plan (see compiler_blowup) or raise PBI_EXEC_EXPLAIN_BUDGET_MS for this model.',
    });
  }
  if (test?.mode === 'deferred' || tel?.outcome === 'deferred') {
    out.push({
      detector: 'validation_deferred',
      evidence: 'Explain check ran out of planning time; validation moved to parity execution',
      action: 'Parity execution (10-minute budget) decides whether the SQL is valid and correct.',
    });
  }

  // ── capability gaps (structured, so they can be counted across the estate) ──
  let gap = (ef?.gap ?? null) as { kind?: string; name?: string } | null;
  // Rows stored before the compiler tagged this gap carry only the message.
  if (!gap && typeof ef?.reason === 'string' && /CALCULATE context transition on the current row/.test(ef.reason)) {
    gap = { kind: 'semantic', name: 'calculate_row_transition' };
  }
  if (gap?.kind === 'm_step' || gap?.kind === 'm_fn') {
    out.push({
      detector: 'pq_capability_gap',
      evidence: `Power Query ${gap.kind === 'm_step' ? 'step' : 'function'} ${gap.name} is not modeled`,
      action: `Model ${gap.name} in m-lineage.ts (or a registry rule) — it unblocks every measure that reads this table.`,
    });
  } else if (gap?.kind === 'semantic') {
    out.push({
      detector: 'dax_capability_gap',
      evidence: `DAX semantics "${gap.name}" are not modeled by the compiler`,
      action:
        gap.name === 'calculate_row_transition'
          ? 'CALCULATE inside a calculated column (or iterator) filters by the current row — compiler work item: row-level context transition (v2 Phase 5).'
          : `Model "${gap.name}" in dax-sql-compile.ts.`,
    });
  } else if (gap?.kind) {
    out.push({
      detector: 'dax_capability_gap',
      evidence: `DAX ${gap.kind} ${gap.name} is not modeled`,
      action: `Add ${gap.name} to the compiler or synthesize a registry rule (rule-synthesize).`,
    });
  }

  // ── data type defects surfaced by Databricks ──────────────────────────────
  const errText = [ef?.reason, (props?.parity as Record<string, unknown> | undefined)?.summary]
    .filter((x): x is string => typeof x === 'string')
    .join(' ');
  const cast = errText.match(/The value '([^']{0,60})'[^"]*of the type "(\w+)" cannot be cast to "(\w+)"/i);
  if (cast) {
    out.push({
      detector: 'cast_error',
      evidence: `Source data holds ${cast[2]} value '${cast[1]}' that cannot be converted to ${cast[3]}`,
      action: 'A text value sits in a numeric column (Power BI turns it into an error or BLANK) — clean the source or add a TRY_CAST rule for this column.',
    });
  }

  // ── parity value patterns ─────────────────────────────────────────────────
  if (parity && parity.verdict === 'fail') {
    const o = num(parity.oracle_value);
    const s = num(parity.sql_value);
    const blank = (v: unknown) => v === null || v === undefined || v === '';
    if (blank(parity.sql_value) && !blank(parity.oracle_value)) {
      out.push({
        detector: 'empty_sql_result',
        evidence: `SQL returned BLANK while Power BI shows ${String(parity.oracle_value)}`,
        action: 'A filter or join removes every row — compare table row counts (decomposition) and Power Query filters.',
      });
    } else if (!blank(parity.sql_value) && blank(parity.oracle_value)) {
      out.push({
        detector: 'blank_mismatch',
        evidence: `Power BI shows BLANK while SQL returns ${String(parity.sql_value)}`,
        action: 'Power BI filters these rows out (RLS, report-level filter, or BLANK semantics) — check the measure context.',
      });
    } else if (o !== null && s !== null && o !== 0) {
      const ratio = s / o;
      const near = (x: number, t: number, tol = 0.01) => Math.abs(x - t) <= Math.abs(t) * tol;
      const scale = [100, 0.01, 1000, 0.001, 1_000_000, 0.000001].find((k) => near(ratio, k));
      if (scale !== undefined) {
        out.push({
          detector: 'scale_mismatch',
          evidence: `SQL = ${fmt(ratio)} × Power BI (${fmt(s)} vs ${fmt(o)})`,
          action: 'Unit or percent scaling differs — check FORMAT / DIVIDE by 100 / unit conversion in the measure or source.',
        });
      } else if (near(ratio, -1)) {
        out.push({
          detector: 'sign_flip',
          evidence: `SQL has the opposite sign (${fmt(s)} vs ${fmt(o)})`,
          action: 'A subtraction or sign convention is reversed — compare the measure terms (decomposition).',
        });
      } else if (ratio >= 1.95 && near(ratio, Math.round(ratio), 0.005)) {
        out.push({
          detector: 'row_fanout',
          evidence: `SQL = exactly ${Math.round(ratio)} × Power BI (${fmt(s)} vs ${fmt(o)})`,
          action: 'Rows are duplicated by a join (many-to-many or a non-unique key) — check relationship key uniqueness.',
        });
      } else if (Math.abs(ratio - 1) <= 0.03) {
        out.push({
          detector: 'boundary_rows',
          evidence: `Off by ${fmt(Math.abs(ratio - 1) * 100)}% (${fmt(s)} vs ${fmt(o)})`,
          action: 'A few rows differ — usually a date cut-off, the relationship blank row, or rows added after the dataset refresh.',
        });
      }
    } else if (o === null && s !== null && typeof parity.oracle_value === 'string') {
      out.push({
        detector: 'type_mismatch',
        evidence: `Power BI returns text ("${String(parity.oracle_value).slice(0, 40)}") while SQL returns a number`,
        action: 'Compare the numeric base measure, or make parity text-aware for this format.',
      });
    }
  }
  return out;
}
