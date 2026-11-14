/**
 * LLM investigator protocol (Architecture v2, Phase 4) — pure parts: the case file the LLM sees
 * (under the data policy), the system prompt, the response schema, and vetting of the probes it
 * asks for. The server loop lives in investigator.ts.
 */

import { z } from 'zod';

import { parseDax } from '@/lib/powerbi/dax-parse';
import type { ProbeResult } from '@/lib/powerbi/decompose-plan';
import { LLM_DATA_POLICY, policyErrorText, policyText, policyValue } from '@/lib/powerbi/investigator-policy';
import type { Playbook } from '@/lib/powerbi/playbooks';

export const INVESTIGATOR_PROMPT_VERSION = 'pbi-investigator-v1';
export const LIMITS = { rounds: 3, probesPerRound: 4, probesTotal: 8, probeDaxChars: 1500 };

export const SYSTEM_PROMPT = `You are the investigator of a pipeline that recreates Power BI DAX measures as Databricks SQL.
A measure is not recreated. Find the precise cause and the fix.
You receive a case file: the measure's DAX, the model objects it depends on, what the pipeline recorded
(root cause, detector evidence, compile/warehouse errors, Power BI vs SQL values), decomposition probes
(parts of the measure evaluated in Power BI and in SQL), and playbooks of known failure patterns.

Data policy: you only ever see metadata and aggregate values (counts, totals, dates). Never ask for rows,
sample records or text values; text results are withheld.

You may ask for more probes: each is ONE scalar DAX expression evaluated in Power BI and, compiled, in SQL —
e.g. COUNTROWS('T'), CALCULATE(SUM('T'[x]), 'T'[y] = 1), COUNTROWS(VALUES('T'[c])), [Some Measure].
Ask only for probes that separate hypotheses. At most ${LIMITS.probesPerRound} per round.

Answer with strict JSON only:
{"status":"need_probes"|"diagnosed",
 "probes":[{"dax":"...","why":"..."}],
 "diagnosis":"one paragraph: what differs and why",
 "category":"replica_drift|data_freshness|pq_unsupported|unsupported_dax|engine_limit|warehouse_timeout|parity_mismatch|harvest_gap|new_pattern",
 "confidence":0.0,
 "fix":{"kind":"rule|compiler|steward|owner|none","summary":"what to change and where","dax_function":{"name":"FN","arity":2}}}
- "rule" only for a single DAX function the compiler lacks (give dax_function); "compiler" for semantics or
  Power Query handling; "steward" for warehouse data / bindings / replica schema; "owner" for the Power BI dataset.
- Never propose hardcoding a report, table, column or measure name.
- If evidence is insufficient after your probes, say so with low confidence.`;

export const InvestigatorReply = z.object({
  status: z.enum(['need_probes', 'diagnosed']),
  probes: z.array(z.object({ dax: z.string(), why: z.string().default('') })).default([]),
  diagnosis: z.string().default(''),
  category: z.string().default('new_pattern'),
  confidence: z.number().min(0).max(1).catch(0),
  fix: z
    .object({
      kind: z.enum(['rule', 'compiler', 'steward', 'owner', 'none']).catch('none'),
      summary: z.string().default(''),
      dax_function: z.object({ name: z.string(), arity: z.number().int().min(0).max(10) }).nullish(),
    })
    .default({ kind: 'none', summary: '' }),
});
export type InvestigatorReply = z.infer<typeof InvestigatorReply>;

/** A probe the LLM may run: one parseable scalar DAX expression, bounded in size. */
export function vetProbe(dax: string): { ok: true; dax: string } | { ok: false; reason: string } {
  const t = dax.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > LIMITS.probeDaxChars) return { ok: false, reason: 'too long' };
  if (/^\s*(EVALUATE|DEFINE)\b/i.test(t)) return { ok: false, reason: 'give a scalar expression, not a query' };
  // table expressions would return rows, which the data policy does not allow
  if (/^\s*(FILTER|VALUES|DISTINCT|ALL|SUMMARIZE|SUMMARIZECOLUMNS|ADDCOLUMNS|SELECTCOLUMNS|TOPN|CALCULATETABLE|DATATABLE)\s*\(/i.test(t)) {
    return { ok: false, reason: 'table expression — wrap it in COUNTROWS / an aggregate' };
  }
  try {
    parseDax(t);
  } catch (e) {
    return { ok: false, reason: `does not parse: ${(e as Error).message.slice(0, 120)}` };
  }
  return { ok: true, dax: t };
}

export type CaseFileInput = {
  model: string;
  measure: string;
  dax: string;
  calledMeasures: { name: string; dax: string }[];
  calcColumns: { table: string; column: string; dax: string }[];
  tables: { name: string; source: string | null; uc: string | null; pqSteps: string[] }[];
  relationships: string[];
  rootCause: { category: string; detail: string; precise?: boolean } | null;
  detectors: { detector: string; evidence: string }[];
  failure: { stage?: unknown; reason?: unknown; gap?: unknown } | null;
  parity: { verdict?: unknown; oracle_value?: unknown; sql_value?: unknown } | null;
  probes: ProbeResult[];
  playbooks: Playbook[];
};

/** The case file sent to the LLM — every data value passes the data policy. */
export function buildCaseFile(c: CaseFileInput) {
  const probe = (p: ProbeResult) => ({
    part: p.label,
    dax: policyText(p.dax, 600),
    power_bi: policyValue(p.pbi),
    sql: policyValue(p.sql),
    status: p.status,
    ...(p.error ? { error: policyErrorText(p.error, 300) } : {}),
  });
  return {
    data_policy: LLM_DATA_POLICY,
    model: c.model,
    measure: c.measure,
    dax: policyText(c.dax, 6000),
    called_measures: c.calledMeasures.slice(0, 15).map((m) => ({ name: m.name, dax: policyText(m.dax, 1200) })),
    calculated_columns: c.calcColumns.slice(0, 15).map((x) => ({ ...x, dax: policyText(x.dax, 800) })),
    tables: c.tables.slice(0, 20),
    relationships: c.relationships.slice(0, 30),
    recorded: {
      root_cause: c.rootCause
        ? { category: c.rootCause.category, detail: policyErrorText(c.rootCause.detail, 600), precise: c.rootCause.precise }
        : null,
      detectors: c.detectors.map((d) => ({ detector: d.detector, evidence: policyErrorText(d.evidence, 300) })),
      failure: c.failure
        ? { stage: c.failure.stage ?? null, reason: policyErrorText(c.failure.reason, 1200), gap: c.failure.gap ?? null }
        : null,
      parity: c.parity
        ? { verdict: c.parity.verdict ?? null, power_bi: policyValue(c.parity.oracle_value), sql: policyValue(c.parity.sql_value) }
        : null,
    },
    decomposition: c.probes.slice(0, 30).map(probe),
    playbooks: c.playbooks.slice(0, 5).map((p) => ({ id: p.id, title: p.title, confirm: p.confirm, fix: p.fix })),
  };
}

export function probeResultsForLlm(results: ProbeResult[]) {
  return results.map((p) => ({
    dax: policyText(p.dax, 600),
    why: p.label,
    power_bi: policyValue(p.pbi),
    sql: policyValue(p.sql),
    status: p.status,
    ...(p.error ? { error: policyErrorText(p.error, 300) } : {}),
  }));
}
