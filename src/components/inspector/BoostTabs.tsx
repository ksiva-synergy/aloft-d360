'use client';

import React, { useState, useCallback } from 'react';
import { BOOST_MODELS, type BoostModel, type ModelTier } from '@/lib/boost/models';
import { BOOST_SUITE_V1, BOOST_SUITE_V2, type BoostCase } from '@/lib/boost/suite';
import type { ToolKind } from '@/lib/boost/classify';

// Accent colors stay literal (concatenated with hex-opacity suffixes; readable on
// both themes). Surface/text/border tokens resolve from the `--pl-*` CSS custom
// properties defined in globals.css (`:root` light + `.dark` override), so the
// Performance Lab flips with the global light/dark toggle.
const GOLD = '#FDB515';
const SURF = 'var(--pl-surf)';
const SURF2 = 'var(--pl-surf2)';
const BORDER = 'var(--pl-border)';
const BORDER2 = 'var(--pl-border2)';
const TXT = 'var(--pl-txt)';
const TXT2 = 'var(--pl-txt2)';
const GREEN = '#22c55e';
const BLUE = '#3A7BD5';
const RED = '#f43f5e';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

// ── Suite definitions ─────────────────────────────────────────────────────────
const SUITE_OPTIONS = [
  { id: 'boost_suite_v1', label: 'Context Boost v1 · 6 cases', cases: BOOST_SUITE_V1 },
  { id: 'boost_suite_v2', label: 'Context Boost v2 · 10 cases', cases: BOOST_SUITE_V2 },
] as const;
type SuiteId = typeof SUITE_OPTIONS[number]['id'];

function getCaseById(id: string): BoostCase | undefined {
  return [...BOOST_SUITE_V1, ...BOOST_SUITE_V2].find(c => c.id === id);
}

// ── JoinPath badge block ──────────────────────────────────────────────────────
function JoinPathBlock({ joinPath }: { joinPath: NonNullable<BoostCase['joinPath']> }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        ...mono, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: GOLD, marginBottom: 7, fontWeight: 600,
      }}>
        JOIN PATH
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 7 }}>
        {joinPath.tables.map(t => (
          <span key={t} style={{
            ...mono, fontSize: 9.5, color: '#93c5fd',
            border: '1px solid rgba(147,197,253,0.35)',
            borderRadius: 4, padding: '2px 7px',
            background: 'rgba(147,197,253,0.06)',
          }}>
            {t}
          </span>
        ))}
      </div>
      <div style={{ ...mono, fontSize: 10, color: TXT2 }}>
        Keys: {joinPath.keys.join(', ')}
      </div>
    </div>
  );
}

// ── HarnessStrength badge ─────────────────────────────────────────────────────
function HarnessStrengthBadge({ strength }: { strength: NonNullable<BoostCase['harnessStrength']> }) {
  const isStrong = strength === 'STRONG';
  return (
    <span style={{
      ...mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
      borderRadius: 4, padding: '2px 8px', border: '1px solid',
      color: isStrong ? GOLD : TXT2,
      borderColor: isStrong ? 'rgba(253,181,21,0.5)' : 'rgba(136,146,164,0.4)',
      background: isStrong ? 'rgba(253,181,21,0.08)' : 'rgba(136,146,164,0.06)',
      flexShrink: 0,
    }}>
      {isStrong ? 'HARNESS LOAD-BEARING' : 'HARNESS ADVANTAGE'}
    </span>
  );
}

export interface SemanticDimensionScore {
  score: number;
  rationale: string;
}

export interface SemanticDetailPayload {
  composite?: number;
  dimensions?: {
    completeness?: SemanticDimensionScore;
    scope_fit?: SemanticDimensionScore;
    analytical_depth?: SemanticDimensionScore;
    structure?: SemanticDimensionScore;
  };
  summary?: string;
  groundedness_detail?: unknown;
}

export interface BoostRunSummary {
  id: string;
  outcome: string;
  tool_calls_total: number;
  tool_calls_discovery: number;
  tool_calls_catalog: number;
  tool_calls_data: number;
  tool_calls_error: number;
  input_tokens: number;
  output_tokens: number;
  loops: number;
  latency_ms: number;
  groundedness: number | null;
  semantic_score: number | null;
  semantic_detail: SemanticDetailPayload | null;
  answer_excerpt: string | null;
  captured_at: string;
  case_id: string;
  model_key: string;
  context_mode: string;
}

type BoostMatrix = Record<string, Record<string, Record<string, BoostRunSummary>>>;

export interface BoostScoreEntry {
  ctxEfficiency: number | null;
  sqlEfficiency: number | null;
  tokenReduction: number | null;
  discoveryCallReduction: number | null;
  outcomeFlips: number;
}

export interface BoostResultsPayload {
  runs: BoostRunSummary[];
  matrix: BoostMatrix;
  boostScores: Record<string, BoostScoreEntry>;
}

export function useBoostResults() {
  const [data, setData] = useState<BoostResultsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchBoostResults = useCallback(async () => {
    if (fetched) return;
    setLoading(true);
    try {
      const res = await fetch('/api/inspector/boost/results');
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [fetched]);

  return { data, loading, fetchBoostResults };
}

const TIER_ORDER: Record<ModelTier, number> = { frontier: 0, production: 1, value: 2, cheap: 3, reasoning: 4 };
function sortedBoostModels(): BoostModel[] {
  return [...BOOST_MODELS].sort((a, b) => {
    const td = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    return td !== 0 ? td : a.label.localeCompare(b.label);
  });
}

function fmt(n: number, d = 0) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtMs(ms: number) { return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`; }

export function BoostEmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ ...mono, fontSize: 13, color: TXT2, marginBottom: 16 }}>
        No benchmark runs yet. Use the dispatch API to run your first benchmark:
      </div>
      <div style={{
        background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 6,
        padding: '16px 20px', textAlign: 'left', maxWidth: 680, margin: '0 auto',
      }}>
        <pre style={{ ...mono, fontSize: 11, color: TXT, margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{[
          'curl -X POST http://localhost:3137/api/inspector/boost/dispatch \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{"caseId":"crew_synthesis_90d","modelKey":"sonnet-4-6","contextMode":"harvested"}\''
        ].join('\n')}</pre>
      </div>
    </div>
  );
}

function ModePill({ mode }: { mode: string }) {
  const ctx = mode === 'harvested';
  return (
    <span style={{
      ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
      borderRadius: 4, padding: '3px 8px', border: '1px solid',
      color: ctx ? GOLD : BLUE,
      borderColor: ctx ? 'rgba(253,181,21,0.5)' : 'rgba(58,123,213,0.5)',
      background: ctx ? 'rgba(253,181,21,0.10)' : 'rgba(58,123,213,0.10)',
    }}>
      {ctx ? 'CTX · Harvested' : 'SQL · Warehouse-only'}
    </span>
  );
}

function OutcomeDot({ outcome }: { outcome: string }) {
  const ok = outcome === 'completed';
  return (
    <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
      display: 'inline-flex', alignItems: 'center', gap: 6, color: ok ? GREEN : RED }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? GREEN : RED, display: 'inline-block' }} />
      {outcome}
    </span>
  );
}

function MetricRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '9px 0', borderBottom: '1px dashed var(--pl-hair)' }}>
      <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: TXT2 }}>{label}</span>
      <span style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 18, fontWeight: 600, color: color || TXT }}>
        {value}{sub && <small style={{ ...mono, fontSize: 10, color: TXT2, fontWeight: 400, marginLeft: 4 }}>{sub}</small>}
      </span>
    </div>
  );
}
export function ContextBoostTab({ data, loading }: { data: BoostResultsPayload | null; loading: boolean }) {
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  if (loading) return <div style={{ ...mono, fontSize: 12, color: TXT2, padding: '32px', textAlign: 'center' }}>Loading benchmark data…</div>;
  if (!data || data.runs.length === 0) return <BoostEmptyState />;

  // Find cases that have both CTX and SQL for at least one model
  const casesWithPairs = new Set<string>();
  const modelsWithPairs = new Set<string>();
  for (const [mk, modes] of Object.entries(data.matrix)) {
    const ctx = modes['harvested'] ?? {};
    const sql = modes['warehouse_only'] ?? {};
    for (const caseId of Object.keys(ctx)) {
      if (sql[caseId]) { casesWithPairs.add(caseId); modelsWithPairs.add(mk); }
    }
  }
  if (casesWithPairs.size === 0) return <BoostEmptyState />;

  // Rank models: prefer frontier/production, deprioritize cheap/reasoning
  const MODEL_TIER_PRIO: Record<string, number> = { frontier: 0, production: 1, value: 2, cheap: 3, reasoning: 4 };
  const sortedModels = [...modelsWithPairs].sort((a, b) => {
    const ma = BOOST_MODELS.find(m => m.key === a);
    const mb = BOOST_MODELS.find(m => m.key === b);
    return (MODEL_TIER_PRIO[ma?.tier ?? 'cheap'] ?? 3) - (MODEL_TIER_PRIO[mb?.tier ?? 'cheap'] ?? 3);
  });

  const activeModel = selectedModel && sortedModels.includes(selectedModel) ? selectedModel : sortedModels[0];

  const caseList = Array.from(casesWithPairs).filter(caseId => {
    const modes = data.matrix[activeModel];
    return modes?.['harvested']?.[caseId] && modes?.['warehouse_only']?.[caseId];
  });
  if (caseList.length === 0) return <BoostEmptyState />;

  const activeCase = selectedCase && caseList.includes(selectedCase) ? selectedCase : caseList[0];

  const ctxRun = data.matrix[activeModel]?.['harvested']?.[activeCase] ?? null;
  const sqlRun = data.matrix[activeModel]?.['warehouse_only']?.[activeCase] ?? null;
  if (!ctxRun || !sqlRun) return <BoostEmptyState />;

  const modelKey = activeModel;
  const model = BOOST_MODELS.find(m => m.key === modelKey);
  const caseLabel = activeCase.replace(/_/g, ' ');

  const ctxTotal = ctxRun.input_tokens + ctxRun.output_tokens;
  const sqlTotal = sqlRun.input_tokens + sqlRun.output_tokens;
  const callReduction = sqlRun.tool_calls_total > 0 ? ((sqlRun.tool_calls_total - ctxRun.tool_calls_total) / sqlRun.tool_calls_total) * 100 : 0;
  const discReduction = sqlRun.tool_calls_discovery > 0 ? ((sqlRun.tool_calls_discovery - ctxRun.tool_calls_discovery) / sqlRun.tool_calls_discovery) * 100 : 0;
  const outcomeFlip = ctxRun.outcome === 'completed' && sqlRun.outcome !== 'completed';

  const colCard = (run: BoostRunSummary, isCtx: boolean) => (
    <div style={{
      border: `1px solid ${isCtx ? 'rgba(253,181,21,0.4)' : 'rgba(244,63,94,0.35)'}`,
      borderRadius: 6, background: SURF, overflow: 'hidden', flex: 1,
    }}>
      <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--pl-hair)' }}>
        <ModePill mode={isCtx ? 'harvested' : 'warehouse_only'} />
        <OutcomeDot outcome={run.outcome} />
      </div>
      <div style={{ padding: 16 }}>
        <MetricRow label="Tool calls" value={String(run.tool_calls_total)}
          sub={`${run.tool_calls_catalog ?? 0} catalog · ${run.tool_calls_data ?? 0} data`} />
        <MetricRow label="Schema-discovery calls" value={String(run.tool_calls_discovery)}
          color={run.tool_calls_discovery === 0 ? GREEN : RED} />
        <MetricRow label="Reasoning loops" value={String(run.loops)} />
        <MetricRow label="Tokens (in / out)"
          value={`${fmt(run.input_tokens + run.output_tokens)}`}
          sub={`${fmt(run.input_tokens)} / ${fmt(run.output_tokens)}`} />
        <MetricRow label="Latency" value={fmtMs(run.latency_ms)} />
        {run.groundedness !== null
          ? <MetricRow label="Groundedness" value={Number(run.groundedness).toFixed(2)} color={GREEN} />
          : <MetricRow label="Groundedness" value="—" color={TXT2} />}
        {run.semantic_score !== null
          ? <MetricRow label="Semantic" value={Number(run.semantic_score).toFixed(2)} color={GOLD} />
          : <MetricRow label="Semantic" value="—" color={TXT2} />}
        {run.answer_excerpt && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--pl-hair)', paddingTop: 13 }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: TXT2, marginBottom: 7 }}>Terminal answer</div>
            <div style={{
              fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 13,
              color: run.outcome === 'completed' ? TXT : RED,
              fontStyle: run.outcome === 'completed' ? 'italic' : 'normal',
              lineHeight: 1.5,
            }}>
              {run.answer_excerpt.slice(0, 200)}{run.answer_excerpt.length > 200 ? '…' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 8 }}>A/B Isolation · one task · two modes</div>
      <h2 style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 21, margin: '0 0 4px', letterSpacing: '-0.01em', color: TXT }}>The same model. The same question. Context on, context off.</h2>
      <p style={{ color: TXT2, fontSize: 13.5, maxWidth: '70ch', margin: '0 0 20px' }}>Identical task, two modes. The warehouse run may show fewer tokens precisely because it died early. Outcome gates everything else.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' as const }}>
        {/* Model selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...mono, fontSize: 9.5, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Model</span>
          <select value={activeModel} onChange={e => setSelectedModel(e.target.value)} style={{
            ...mono, fontSize: 11, color: TXT, background: SURF2, border: `1px solid ${BORDER2}`,
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer', outline: 'none',
          }}>
            {sortedModels.map(mk => {
              const m = BOOST_MODELS.find(x => x.key === mk);
              return <option key={mk} value={mk}>{m?.label ?? mk} ({m?.tier ?? ''})</option>;
            })}
          </select>
        </div>

        {/* Case selector */}
        {caseList.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...mono, fontSize: 9.5, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Case</span>
            <select value={activeCase} onChange={e => setSelectedCase(e.target.value)} style={{
              ...mono, fontSize: 11, color: TXT, background: SURF2, border: `1px solid ${BORDER2}`,
              borderRadius: 6, padding: '6px 12px', cursor: 'pointer', outline: 'none',
            }}>
              {caseList.map(c => {
                const bc = getCaseById(c);
                return <option key={c} value={c}>{c.replace(/_/g, ' ')}{bc?.difficulty ? ` (${bc.difficulty})` : ''}</option>;
              })}
            </select>
          </div>
        )}
      </div>

      <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: TXT2, marginBottom: 5 }}>Task · {caseLabel}</div>
          <div style={{ ...mono, fontSize: 12, color: TXT }}>Case: {activeCase}</div>
        </div>
        {model && <span style={{ ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', borderRadius: 4, padding: '3px 8px', border: '1px solid rgba(253,181,21,0.5)', color: GOLD, background: 'rgba(253,181,21,0.10)' }}>{model.label}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {colCard(ctxRun, true)}
        {colCard(sqlRun, false)}
      </div>

      <div style={{ marginTop: 16, border: `1px solid ${BORDER2}`, borderRadius: 6, background: 'var(--pl-grad)', padding: '18px 20px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 18, alignItems: 'center' }}>
        <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 16, color: TXT }}>
          Context Boost Score
          <span style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, display: 'block', marginTop: 4, fontWeight: 400 }}>harvested vs warehouse-only · this task</span>
        </div>
        <div>
          <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 30, lineHeight: 1, color: outcomeFlip ? GREEN : TXT2 }}>{outcomeFlip ? 'PASS' : 'NO FLIP'}</div>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, marginTop: 6 }}>outcome flip<br />truncated → complete</div>
        </div>
        <div>
          <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 30, lineHeight: 1, color: GOLD }}>{callReduction >= 0 ? `−${fmt(callReduction, 0)}%` : `+${fmt(-callReduction, 0)}%`}</div>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, marginTop: 6 }}>tool calls<br />{sqlRun.tool_calls_total} → {ctxRun.tool_calls_total}</div>
        </div>
        <div>
          <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 30, lineHeight: 1, color: GOLD }}>{discReduction >= 0 ? `−${fmt(discReduction, 0)}%` : `+${fmt(-discReduction, 0)}%`}</div>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, marginTop: 6 }}>schema discovery<br />{sqlRun.tool_calls_discovery} → {ctxRun.tool_calls_discovery}</div>
        </div>
      </div>

      <div style={{ ...mono, fontSize: 10.5, color: TXT2, marginTop: 14, padding: '10px 13px', borderLeft: `2px solid ${GOLD}`, background: SURF }}>
        🟡 <strong style={{ color: GOLD }}>Why outcome must gate efficiency:</strong> a truncated run may show fewer tokens — it spent its budget on schema discovery and never answered. We only compare tokens, latency, and loops <strong style={{ color: TXT }}>among completed runs</strong>. A truncated run scores zero on efficiency regardless of how few tokens it burned.
      </div>
    </div>
  );
}
export function ModelMatrixTab({ data, loading }: { data: BoostResultsPayload | null; loading: boolean }) {
  const [expandedTier, setExpandedTier] = useState<string | null>('hard');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);

  if (loading) return <div style={{ ...mono, fontSize: 12, color: TXT2, padding: '32px', textAlign: 'center' }}>Loading matrix…</div>;
  if (!data || data.runs.length === 0) return <BoostEmptyState />;

  const allCases = Array.from(new Set(data.runs.map(r => r.case_id).filter(Boolean))) as string[];
  if (allCases.length === 0) return <BoostEmptyState />;

  const models = sortedBoostModels();
  const outcomeColor = (outcome: string) => outcome === 'completed' ? GREEN : outcome === 'errored' ? '#f97316' : RED;
  const cellBg = (outcome: string) => outcome === 'completed' ? 'linear-gradient(180deg,rgba(34,197,94,0.08),var(--pl-surf))' : outcome === 'errored' ? 'linear-gradient(180deg,rgba(249,115,22,0.08),var(--pl-surf))' : 'linear-gradient(180deg,rgba(244,63,94,0.08),var(--pl-surf))';

  const tiers: { id: string; label: string; color: string; cases: BoostCase[] }[] = [
    { id: 'easy', label: 'EASY', color: GREEN, cases: [...BOOST_SUITE_V2].filter(c => c.difficulty === 'easy') },
    { id: 'medium', label: 'MEDIUM', color: GOLD, cases: [...BOOST_SUITE_V2].filter(c => c.difficulty === 'medium') },
    { id: 'hard', label: 'HARD', color: RED, cases: [...BOOST_SUITE_V2].filter(c => c.difficulty === 'hard') },
  ];

  // Compute tier-level summary stats
  function tierStats(cases: BoostCase[]) {
    const caseIds = cases.map(c => c.id).filter(id => allCases.includes(id));
    let ctxComplete = 0, ctxTotal = 0, sqlComplete = 0, sqlTotal = 0, flips = 0;
    for (const caseId of caseIds) {
      for (const model of models) {
        const ctx = data!.matrix[model.key]?.['harvested']?.[caseId];
        const sql = data!.matrix[model.key]?.['warehouse_only']?.[caseId];
        if (ctx) { ctxTotal++; if (ctx.outcome === 'completed') ctxComplete++; }
        if (sql) { sqlTotal++; if (sql.outcome === 'completed') sqlComplete++; }
        if (ctx?.outcome === 'completed' && sql && sql.outcome !== 'completed') flips++;
      }
    }
    return { ctxComplete, ctxTotal, sqlComplete, sqlTotal, flips, caseCount: caseIds.length };
  }

  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 8 }}>Task x model x context · benchmark matrix</div>
      <h2 style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 21, margin: '0 0 4px', color: TXT }}>Does the harness beat raw model strength?</h2>
      <p style={{ color: TXT2, fontSize: 13.5, maxWidth: '70ch', margin: '0 0 24px' }}>Grouped by difficulty. Click a tier to expand model results per case. If a weaker model <em>with</em> the harness beats a frontier model <em>without</em> it, the harness is doing the work.</p>

      {tiers.map(tier => {
        const stats = tierStats(tier.cases);
        const isExpanded = expandedTier === tier.id;
        const tierCaseIds = tier.cases.map(c => c.id).filter(id => allCases.includes(id));

        return (
          <div key={tier.id} style={{ marginBottom: 16 }}>
            {/* Tier header — clickable */}
            <button
              onClick={() => setExpandedTier(isExpanded ? null : tier.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 6,
                padding: '14px 18px', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  ...mono, fontSize: 11, letterSpacing: '0.12em', fontWeight: 700,
                  color: tier.color, padding: '3px 10px', borderRadius: 4,
                  border: `1px solid ${tier.color}55`, background: `${tier.color}11`,
                }}>
                  {tier.label}
                </span>
                <span style={{ ...mono, fontSize: 11, color: TXT }}>
                  {stats.caseCount} case{stats.caseCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ ...mono, fontSize: 10, color: TXT2 }}>
                  CTX <strong style={{ color: GREEN }}>{stats.ctxComplete}/{stats.ctxTotal}</strong>
                </span>
                <span style={{ ...mono, fontSize: 10, color: TXT2 }}>
                  SQL <strong style={{ color: BLUE }}>{stats.sqlComplete}/{stats.sqlTotal}</strong>
                </span>
                {stats.flips > 0 && (
                  <span style={{ ...mono, fontSize: 10, color: GREEN }}>
                    {stats.flips} flip{stats.flips !== 1 ? 's' : ''}
                  </span>
                )}
                <span style={{ ...mono, fontSize: 12, color: TXT2 }}>{isExpanded ? '▾' : '▸'}</span>
              </div>
            </button>

            {/* Expanded detail — model grid per case */}
            {isExpanded && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 8 }}>
                {tierCaseIds.map(caseId => {
                  const bc = getCaseById(caseId);
                  const isCaseExpanded = expandedCase === caseId;

                  return (
                    <div key={caseId} style={{
                      border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden',
                      background: isCaseExpanded ? SURF : 'transparent',
                    }}>
                      {/* Case row header */}
                      <button
                        onClick={() => setExpandedCase(isCaseExpanded ? null : caseId)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'transparent', border: 'none', padding: '12px 16px', cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                          <span style={{ ...mono, fontSize: 10, color: isCaseExpanded ? GOLD : TXT2 }}>{isCaseExpanded ? '▾' : '▸'}</span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: TXT }}>{bc?.title ?? caseId.replace(/_/g, ' ')}</span>
                          {bc?.harnessStrength && <HarnessStrengthBadge strength={bc.harnessStrength} />}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {models.slice(0, 5).map(model => {
                            const ctx = data.matrix[model.key]?.['harvested']?.[caseId];
                            const sql = data.matrix[model.key]?.['warehouse_only']?.[caseId];
                            const ctxOk = ctx?.outcome === 'completed';
                            const sqlOk = sql?.outcome === 'completed';
                            return (
                              <span key={model.key} title={`${model.label}: CTX ${ctx?.outcome ?? 'none'} / SQL ${sql?.outcome ?? 'none'}`} style={{
                                display: 'inline-flex', gap: 2,
                              }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ctx ? outcomeColor(ctx.outcome) : 'rgba(136,146,164,0.3)' }} />
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sql ? outcomeColor(sql.outcome) : 'rgba(136,146,164,0.3)' }} />
                              </span>
                            );
                          })}
                        </div>
                      </button>

                      {/* Expanded model detail table */}
                      {isCaseExpanded && (
                        <div style={{ padding: '0 16px 16px', overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 6 }}>
                            <thead>
                              <tr>
                                <th style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, fontWeight: 500, padding: '6px 10px', textAlign: 'left', width: 160 }}></th>
                                {['CTX · Harvested', 'SQL · Warehouse-only', 'Harness Lift'].map(h => (
                                  <th key={h} style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, fontWeight: 500, padding: '6px 10px', textAlign: 'center' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {models.map(model => {
                                const ctx = data.matrix[model.key]?.['harvested']?.[caseId];
                                const sql = data.matrix[model.key]?.['warehouse_only']?.[caseId];
                                if (!ctx && !sql) return null;
                                const hasLift = ctx && sql;
                                const callDelta = hasLift ? ((sql!.tool_calls_total - ctx!.tool_calls_total) / Math.max(sql!.tool_calls_total, 1) * 100) : null;
                                const outFlip = ctx?.outcome === 'completed' && sql?.outcome !== 'completed';

                                const cellStyle = (run: BoostRunSummary | undefined): React.CSSProperties => ({
                                  border: `1px solid ${run ? `${outcomeColor(run.outcome)}66` : 'var(--pl-hair)'}`,
                                  borderRadius: 6, padding: '10px 12px', textAlign: 'center', background: run ? cellBg(run.outcome) : SURF,
                                });

                                return (
                                  <tr key={model.key}>
                                    <th style={{ fontWeight: 500, fontSize: 13, textAlign: 'left', padding: '0 6px', verticalAlign: 'middle' }}>
                                      <div style={{ color: TXT }}>{model.label}</div>
                                      <div style={{ ...mono, fontSize: 9, color: TXT2, marginTop: 2 }}>{model.tier}</div>
                                    </th>
                                    <td><div style={{ ...cellStyle(ctx) }}>
                                      {ctx ? (<>
                                        <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 20, color: outcomeColor(ctx.outcome) }}>
                                          {ctx.outcome === 'completed' ? '✓' : '✕'}
                                        </div>
                                        <div style={{ ...mono, fontSize: 9, marginTop: 4, color: outcomeColor(ctx.outcome) }}>{ctx.outcome}</div>
                                        <div style={{ ...mono, fontSize: 9, color: TXT2, marginTop: 4 }}>{ctx.tool_calls_total} calls · {ctx.tool_calls_discovery} disc</div>
                                      </>) : (
                                        <div style={{ ...mono, fontSize: 9, color: TXT2 }}>No run</div>
                                      )}
                                    </div></td>
                                    <td><div style={{ ...cellStyle(sql) }}>
                                      {sql ? (<>
                                        <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 20, color: outcomeColor(sql.outcome) }}>
                                          {sql.outcome === 'completed' ? '✓' : '✕'}
                                        </div>
                                        <div style={{ ...mono, fontSize: 9, marginTop: 4, color: outcomeColor(sql.outcome) }}>{sql.outcome}</div>
                                        <div style={{ ...mono, fontSize: 9, color: TXT2, marginTop: 4 }}>{sql.tool_calls_total} calls · {sql.tool_calls_discovery} disc</div>
                                      </>) : (
                                        <div style={{ ...mono, fontSize: 9, color: TXT2 }}>No run</div>
                                      )}
                                    </div></td>
                                    <td><div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, padding: '10px 12px', textAlign: 'center', background: SURF }}>
                                      {hasLift ? (<>
                                        {outFlip && <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 12, color: GREEN, marginBottom: 3 }}>OUTCOME FLIP</div>}
                                        {callDelta !== null && <div style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 700, fontSize: 20, color: GOLD }}>{callDelta >= 0 ? `−${fmt(callDelta, 0)}%` : `+${fmt(-callDelta, 0)}%`}</div>}
                                        <div style={{ ...mono, fontSize: 9, color: TXT2, marginTop: 4 }}>call reduction</div>
                                      </>) : (
                                        <div style={{ ...mono, fontSize: 9, color: TXT2 }}>Run both modes</div>
                                      )}
                                    </div></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {tierCaseIds.length === 0 && (
                  <div style={{ ...mono, fontSize: 11, color: TXT2, padding: '12px 16px' }}>
                    No runs recorded for this difficulty tier yet.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function BenchmarkSuiteTab({ data, loading }: { data: BoostResultsPayload | null; loading: boolean }) {
  const [sortCol, setSortCol] = useState<string>('captured_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedSuiteId, setSelectedSuiteId] = useState<SuiteId>('boost_suite_v1');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);

  if (loading) return <div style={{ ...mono, fontSize: 12, color: TXT2, padding: '32px', textAlign: 'center' }}>Loading runs…</div>;
  if (!data || data.runs.length === 0) return <BoostEmptyState />;

  const selectedSuite = SUITE_OPTIONS.find(s => s.id === selectedSuiteId)!;
  const suiteCaseIds = new Set(selectedSuite.cases.map(c => c.id));

  const runs = [...data.runs]
    .filter(r => suiteCaseIds.has(r.case_id ?? ''))
    .sort((a, b) => {
      let av: string | number = a[sortCol as keyof typeof a] as string | number ?? '';
      let bv: string | number = b[sortCol as keyof typeof b] as string | number ?? '';
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

  const toggle = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const ctxRuns = runs.filter(r => r.context_mode === 'harvested');
  const sqlRuns = runs.filter(r => r.context_mode === 'warehouse_only');
  const ctxComplete = ctxRuns.filter(r => r.outcome === 'completed').length;
  const sqlComplete = sqlRuns.filter(r => r.outcome === 'completed').length;

  const pairs = runs.filter(r => r.context_mode === 'harvested' && r.outcome === 'completed').map(ctx => {
    const sql = runs.find(s => s.context_mode === 'warehouse_only' && s.case_id === ctx.case_id && s.model_key === ctx.model_key && s.outcome === 'completed');
    if (!sql) return null;
    return (sql.tool_calls_total - ctx.tool_calls_total) / Math.max(sql.tool_calls_total, 1) * 100;
  }).filter((x): x is number => x !== null);

  const meanCallReduction = pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;

  const discPairs = runs.filter(r => r.context_mode === 'harvested' && r.outcome === 'completed').map(ctx => {
    const sql = runs.find(s => s.context_mode === 'warehouse_only' && s.case_id === ctx.case_id && s.model_key === ctx.model_key && s.outcome === 'completed');
    if (!sql || sql.tool_calls_discovery === 0) return null;
    return (sql.tool_calls_discovery - ctx.tool_calls_discovery) / sql.tool_calls_discovery * 100;
  }).filter((x): x is number => x !== null);
  const meanDiscReduction = discPairs.length ? discPairs.reduce((a, b) => a + b, 0) / discPairs.length : null;

  const Th = ({ col, label, right }: { col: string; label: string; right?: boolean }) => (
    <th onClick={() => toggle(col)} style={{
      ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: sortCol === col ? GOLD : TXT2,
      textAlign: right ? 'right' : 'left', padding: '9px 12px', borderBottom: `1px solid ${BORDER}`, fontWeight: 500,
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    }}>
      {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 8 }}>Golden-set · reproducible · the defensible artifact</div>
      <h2 style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 21, margin: '0 0 4px', color: TXT }}>Context Boost Benchmark</h2>
      <p style={{ color: TXT2, fontSize: 13.5, maxWidth: '70ch', margin: '0 0 16px' }}>All runs, most recent first. Click column headers to sort. Color-coded scores: green ≥0.8, gold 0.5–0.8, red &lt;0.5.</p>

      {/* Suite selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ ...mono, fontSize: 9.5, color: TXT2, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Suite</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {SUITE_OPTIONS.map(s => (
            <button key={s.id} onClick={() => setSelectedSuiteId(s.id)} style={{
              ...mono, fontSize: 10, letterSpacing: '0.08em',
              padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${selectedSuiteId === s.id ? 'rgba(253,181,21,0.6)' : 'rgba(136,146,164,0.3)'}`,
              color: selectedSuiteId === s.id ? GOLD : TXT2,
              background: selectedSuiteId === s.id ? 'rgba(253,181,21,0.08)' : 'transparent',
              transition: 'all 0.15s',
            }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th col="case_id" label="Task" />
              <Th col="model_key" label="Model" />
              <Th col="context_mode" label="Mode" />
              <Th col="outcome" label="Outcome" />
              <Th col="tool_calls_total" label="Tool Calls" right />
              <Th col="tool_calls_discovery" label="Discovery" right />
              <Th col="input_tokens" label="Tokens" right />
              <Th col="loops" label="Loops" right />
              <Th col="latency_ms" label="Latency" right />
              <th style={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, textAlign: 'right', padding: '9px 12px', borderBottom: `1px solid ${BORDER}`, fontWeight: 500 }}>Grounded</th>
              <th style={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: TXT2, textAlign: 'right', padding: '9px 12px', borderBottom: `1px solid ${BORDER}`, fontWeight: 500 }}>Semantic</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, i) => {
              const isCtx = run.context_mode === 'harvested';
              const ok = run.outcome === 'completed';
              const model = BOOST_MODELS.find(m => m.key === run.model_key);
              const boostCase = getCaseById(run.case_id ?? '');
              const isExpanded = expandedCase === run.id;
              return (
                <React.Fragment key={run.id}>
                  <tr
                    style={{ background: i % 2 === 0 ? 'transparent' : 'var(--pl-stripe)', cursor: boostCase ? 'pointer' : 'default' }}
                    onClick={() => boostCase && setExpandedCase(isExpanded ? null : run.id)}
                  >
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', fontWeight: 500, fontSize: 13, color: TXT, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ ...mono, fontSize: 10, color: isExpanded ? GOLD : TXT2, flexShrink: 0 }}>{isExpanded ? '▾' : '▸'}</span>
                        {run.case_id?.replace(/_/g, ' ') ?? '—'}
                        {boostCase?.harnessStrength && (
                          <HarnessStrengthBadge strength={boostCase.harnessStrength} />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', ...mono, fontSize: 11, color: TXT2 }}>{model?.label ?? run.model_key}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)' }}>
                      <span style={{ ...mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: isCtx ? GOLD : BLUE }}>{isCtx ? 'CTX' : 'SQL'}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)' }}>
                      <span style={{ ...mono, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 4, padding: '3px 8px', border: '1px solid', color: ok ? GREEN : RED, borderColor: ok ? 'rgba(34,197,94,0.4)' : 'rgba(244,63,94,0.4)' }}>{run.outcome}</span>
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12, color: ok ? TXT : RED }}>{run.tool_calls_total}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12, color: run.tool_calls_discovery > 0 ? RED : GREEN }}>{run.tool_calls_discovery}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12, color: TXT }}>{fmt(run.input_tokens + run.output_tokens)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12, color: TXT2 }}>{run.loops}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12, color: TXT2 }}>{fmtMs(run.latency_ms)}</td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12 }}>
                      {run.groundedness !== null ? <span style={{ color: Number(run.groundedness) >= 0.8 ? GREEN : Number(run.groundedness) >= 0.5 ? GOLD : RED }}>{Number(run.groundedness).toFixed(2)}</span> : <span style={{ color: TXT2 }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 12px', borderBottom: isExpanded ? 'none' : '1px solid var(--pl-hair2)', textAlign: 'right', ...mono, fontSize: 12 }}>
                      {run.semantic_score !== null ? <span style={{ color: Number(run.semantic_score) >= 0.8 ? GREEN : Number(run.semantic_score) >= 0.5 ? GOLD : RED }}>{Number(run.semantic_score).toFixed(2)}</span> : <span style={{ color: TXT2 }}>—</span>}
                    </td>
                  </tr>
                  {isExpanded && boostCase && (
                    <tr style={{ background: i % 2 === 0 ? 'transparent' : 'var(--pl-stripe)' }}>
                      <td colSpan={11} style={{ padding: '0 12px 16px', borderBottom: '1px solid var(--pl-hair2)' }}>
                        <div style={{
                          background: SURF, border: `1px solid ${BORDER}`, borderRadius: 6,
                          padding: '14px 16px',
                        }}>
                          {/* Case title + difficulty */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontSize: 14, fontWeight: 600, color: TXT }}>
                              {boostCase.title}
                            </span>
                            {boostCase.difficulty && (
                              <span style={{
                                ...mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                                borderRadius: 4, padding: '2px 7px', border: '1px solid',
                                color: boostCase.difficulty === 'hard' ? RED : boostCase.difficulty === 'medium' ? GOLD : GREEN,
                                borderColor: boostCase.difficulty === 'hard' ? 'rgba(244,63,94,0.4)' : boostCase.difficulty === 'medium' ? 'rgba(253,181,21,0.4)' : 'rgba(34,197,94,0.4)',
                                background: 'transparent',
                              }}>
                                {boostCase.difficulty}
                              </span>
                            )}
                          </div>

                          {/* Prompt excerpt */}
                          <div style={{ ...mono, fontSize: 10, color: TXT2, marginBottom: 10, fontStyle: 'italic', lineHeight: 1.5 }}>
                            {boostCase.prompt.slice(0, 180)}{boostCase.prompt.length > 180 ? '…' : ''}
                          </div>

                          {/* Expected dimensions */}
                          <div style={{ marginBottom: boostCase.joinPath ? 0 : 0 }}>
                            <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: TXT2, marginBottom: 6 }}>
                              Expected dimensions
                            </div>
                            <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                              {boostCase.expectedDimensions.map((d, di) => (
                                <li key={di} style={{ ...mono, fontSize: 10, color: TXT, lineHeight: 1.6 }}>{d}</li>
                              ))}
                            </ul>
                          </div>

                          {/* JoinPath block — only for non-null joinPath */}
                          {boostCase.joinPath && (
                            <JoinPathBlock joinPath={boostCase.joinPath} />
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18, padding: '14px 16px', background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 6, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><span style={{ ...mono, fontSize: 9.5, color: TXT2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>CTX completion </span><strong style={{ ...mono, color: GREEN }}>{ctxComplete}/{ctxRuns.length}</strong></div>
        <div><span style={{ ...mono, fontSize: 9.5, color: TXT2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>SQL completion </span><strong style={{ ...mono, color: BLUE }}>{sqlComplete}/{sqlRuns.length}</strong></div>
        {meanCallReduction !== null && <div><span style={{ ...mono, fontSize: 9.5, color: TXT2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Mean call reduction </span><strong style={{ ...mono, color: GOLD }}>−{fmt(meanCallReduction, 0)}%</strong></div>}
        {meanDiscReduction !== null && <div><span style={{ ...mono, fontSize: 9.5, color: TXT2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Mean disc elimination </span><strong style={{ ...mono, color: GOLD }}>−{fmt(meanDiscReduction, 0)}%</strong></div>}
      </div>
    </div>
  );
}

export function ScoringMethodologyTab({ data, loading }: { data: BoostResultsPayload | null; loading: boolean }) {
  if (loading) return <div style={{ ...mono, fontSize: 12, color: TXT2, padding: '32px', textAlign: 'center' }}>Loading scoring data…</div>;
  if (!data || data.runs.length === 0) return <BoostEmptyState />;

  const runs = data.runs;
  const ctxRuns = runs.filter(r => r.context_mode === 'harvested');
  const sqlRuns = runs.filter(r => r.context_mode === 'warehouse_only');
  const ctxCompleted = ctxRuns.filter(r => r.outcome === 'completed');
  const sqlCompleted = sqlRuns.filter(r => r.outcome === 'completed');

  const avgDiscoveryCTX = ctxCompleted.length > 0
    ? ctxCompleted.reduce((s, r) => s + r.tool_calls_discovery, 0) / ctxCompleted.length
    : null;
  const avgDiscoverySQL = sqlCompleted.length > 0
    ? sqlCompleted.reduce((s, r) => s + r.tool_calls_discovery, 0) / sqlCompleted.length
    : null;

  const groundedRuns = runs.filter(r => r.groundedness !== null);
  const meanGroundedness = groundedRuns.length > 0
    ? groundedRuns.reduce((s, r) => s + Number(r.groundedness), 0) / groundedRuns.length
    : null;

  const semanticRuns = runs.filter(r => r.semantic_score !== null);
  const meanSemantic = semanticRuns.length > 0
    ? semanticRuns.reduce((s, r) => s + Number(r.semantic_score), 0) / semanticRuns.length
    : null;

  const lowestSemantic = semanticRuns.length > 0
    ? semanticRuns.reduce((min, r) => Number(r.semantic_score) < Number(min.semantic_score) ? r : min)
    : null;

  const layerCardStyle: React.CSSProperties = {
    border: `1px solid ${BORDER2}`,
    borderRadius: 8,
    background: SURF,
    padding: '20px 24px',
    marginBottom: 16,
  };
  const layerLabel: React.CSSProperties = {
    ...mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: GOLD, marginBottom: 10, fontWeight: 600,
  };
  const layerTitle: React.CSSProperties = {
    fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 17,
    color: TXT, marginBottom: 8,
  };
  const layerDesc: React.CSSProperties = { fontSize: 13, color: TXT2, lineHeight: 1.6 };
  const statInline: React.CSSProperties = { ...mono, fontSize: 12, color: GREEN, fontWeight: 600 };

  return (
    <div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: TXT2, marginBottom: 8 }}>Layered evaluation · deterministic + LLM-judged</div>
      <h2 style={{ fontFamily: "'Source Serif 4',Georgia,serif", fontWeight: 600, fontSize: 21, margin: '0 0 4px', color: TXT }}>Scoring Methodology</h2>
      <p style={{ color: TXT2, fontSize: 13.5, maxWidth: '70ch', margin: '0 0 24px' }}>
        Four scoring layers, applied lexicographically. A run must pass each gate before downstream scores matter.
      </p>

      {/* L0 — OUTCOME */}
      <div style={layerCardStyle}>
        <div style={layerLabel}>L0 · OUTCOME</div>
        <div style={layerTitle}>Completed / Truncated / Errored / Incompatible</div>
        <p style={layerDesc}>
          Binary, deterministic, free. The gate: a run that did not finish scores zero everywhere downstream.
          Incompatible runs (no tool-use support) are excluded entirely.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>CTX: <span style={statInline}>{ctxCompleted.length}/{ctxRuns.length}</span> completed</span>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>SQL: <span style={statInline}>{sqlCompleted.length}/{sqlRuns.length}</span> completed</span>
        </div>
      </div>

      {/* L1 — EFFICIENCY */}
      <div style={layerCardStyle}>
        <div style={layerLabel}>L1 · EFFICIENCY</div>
        <div style={layerTitle}>Tool calls (classified), tokens, loops, latency</div>
        <p style={layerDesc}>
          Compared among completed runs only. Formula: <span style={mono}>1000 / (1 + discovery_calls + total_tokens/10000)</span>.
          Discovery calls are the heaviest penalty — blind schema exploration is expensive and unnecessary with context.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>CTX avg discovery: <span style={{ ...statInline, color: avgDiscoveryCTX === 0 ? GREEN : GOLD }}>{avgDiscoveryCTX !== null ? avgDiscoveryCTX.toFixed(1) : '—'}</span></span>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>SQL avg discovery: <span style={{ ...statInline, color: RED }}>{avgDiscoverySQL !== null ? avgDiscoverySQL.toFixed(1) : '—'}</span></span>
        </div>
      </div>

      {/* L2 — GROUNDEDNESS */}
      <div style={layerCardStyle}>
        <div style={layerLabel}>L2 · GROUNDEDNESS</div>
        <div style={layerTitle}>Phantom trace (synthesis) · Consistency check (advisory)</div>
        <p style={layerDesc}>
          <strong>Phantom trace</strong> — for synthesis tasks: counts quantitative claims and traces each to tool output.
          Score = supported / total claims.<br />
          <strong>Consistency check</strong> — for advisory tasks: flags fabricated entities, contradictions, and unsupported causal claims.
          Score = 1.0 minus severity-weighted penalty.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>Scored: <span style={statInline}>{groundedRuns.length}</span> runs</span>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>Mean: <span style={{ ...statInline, color: meanGroundedness !== null && meanGroundedness >= 0.8 ? GREEN : GOLD }}>{meanGroundedness !== null ? meanGroundedness.toFixed(3) : '—'}</span></span>
        </div>
      </div>

      {/* L3 — SEMANTIC QUALITY */}
      <div style={layerCardStyle}>
        <div style={layerLabel}>L3 · SEMANTIC QUALITY</div>
        <div style={layerTitle}>Per-dimension rubric judges: completeness, scope-fit, analytical depth, structure</div>
        <p style={layerDesc}>
          Each dimension scored 0.0–1.0 by Sonnet with a task-specific rubric.
          Composite = average of all four dimensions. Terse or superficial answers score low on completeness
          regardless of groundedness.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>Scored: <span style={statInline}>{semanticRuns.length}</span> runs</span>
          <span style={{ ...mono, fontSize: 11, color: TXT2 }}>Mean: <span style={{ ...statInline, color: meanSemantic !== null && meanSemantic >= 0.8 ? GREEN : GOLD }}>{meanSemantic !== null ? meanSemantic.toFixed(3) : '—'}</span></span>
          {lowestSemantic && (
            <span style={{ ...mono, fontSize: 11, color: TXT2 }}>Lowest: <span style={{ ...statInline, color: RED }}>{Number(lowestSemantic.semantic_score).toFixed(3)}</span> ({lowestSemantic.model_key} / {lowestSemantic.context_mode})</span>
          )}
        </div>
      </div>

      {/* Composite ranking explanation */}
      <div style={{
        marginTop: 8, padding: '16px 20px', borderRadius: 6,
        background: 'var(--pl-grad)',
        border: `1px solid ${BORDER2}`,
      }}>
        <div style={{ ...mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>Composite Ranking</div>
        <p style={{ fontSize: 13, color: TXT, lineHeight: 1.6, margin: 0 }}>
          <strong>Lexicographic:</strong> outcome first, then groundedness, then efficiency, then semantic.
          A completed-but-slow run always beats a truncated-but-lean one. A grounded answer always beats an
          ungrounded one of equal efficiency. This order reflects operational reality: a wrong answer costs more
          than a slow one.
        </p>
      </div>
    </div>
  );
}

