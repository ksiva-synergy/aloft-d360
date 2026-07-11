import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { BOOST_SUITE_VERSION } from '@/lib/boost/suite';
import { BOOST_MODELS } from '@/lib/boost/models';
import { efficiencyScore } from '@/lib/boost/rank';

export const dynamic = 'force-dynamic';

type BoostRunSummary = {
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
  semantic_detail: unknown;
  answer_excerpt: string | null;
  captured_at: Date;
};

type BoostMatrix = Record<string, Record<string, Record<string, BoostRunSummary>>>;

type BoostScores = Record<string, {
  ctxEfficiency: number | null;
  sqlEfficiency: number | null;
  tokenReduction: number | null;
  discoveryCallReduction: number | null;
  outcomeFlips: number;
}>;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const suiteVersion = searchParams.get('suiteVersion') || BOOST_SUITE_VERSION;

  const runs = await prisma.platform_boost_runs.findMany({
    where: { suite_version: suiteVersion },
    orderBy: { captured_at: 'desc' },
  });

  // Build matrix: latest run per (model_key, context_mode, case_id)
  const latestMap = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    const key = `${run.model_key}::${run.context_mode}::${run.case_id}`;
    if (!latestMap.has(key)) {
      latestMap.set(key, run); // runs are ordered desc by captured_at, so first seen = latest
    }
  }

  const matrix: BoostMatrix = {};
  for (const [key, run] of latestMap.entries()) {
    const [modelKey, contextMode, caseId] = key.split('::');
    if (!matrix[modelKey]) matrix[modelKey] = {};
    if (!matrix[modelKey][contextMode]) matrix[modelKey][contextMode] = {};
    matrix[modelKey][contextMode][caseId] = {
      id: run.id,
      outcome: run.outcome,
      tool_calls_total: run.tool_calls_total,
      tool_calls_discovery: run.tool_calls_discovery,
      tool_calls_catalog: run.tool_calls_catalog,
      tool_calls_data: run.tool_calls_data,
      tool_calls_error: run.tool_calls_error,
      input_tokens: run.input_tokens,
      output_tokens: run.output_tokens,
      loops: run.loops,
      latency_ms: run.latency_ms,
      groundedness: run.groundedness ? Number(run.groundedness) : null,
      semantic_score: run.semantic_score ? Number(run.semantic_score) : null,
      semantic_detail: run.semantic_detail ?? null,
      answer_excerpt: run.answer_excerpt ?? null,
      captured_at: run.captured_at,
    };
  }

  // Compute per-model boost scores: CTX vs SQL-only comparison
  // Excludes 'incompatible' runs (models that don't support tool use)
  const boostScores: BoostScores = {};
  for (const model of BOOST_MODELS) {

    const ctxRuns = runs.filter(r => r.model_key === model.key && r.context_mode === 'harvested' && r.outcome === 'completed');
    const sqlRuns = runs.filter(r => r.model_key === model.key && r.context_mode === 'warehouse_only' && r.outcome === 'completed');

    if (ctxRuns.length === 0 && sqlRuns.length === 0) continue;

    const avgEfficiency = (arr: typeof runs) => {
      if (arr.length === 0) return null;
      const total = arr.reduce((sum, r) => sum + efficiencyScore({
        tool_calls_discovery: r.tool_calls_discovery,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
      }), 0);
      return total / arr.length;
    };

    const avgTokens = (arr: typeof runs) => arr.length === 0 ? null : arr.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0) / arr.length;
    const avgDiscovery = (arr: typeof runs) => arr.length === 0 ? null : arr.reduce((s, r) => s + r.tool_calls_discovery, 0) / arr.length;

    // Count cases where CTX completed but SQL did not (outcome flip)
    const ctxCases = new Set(ctxRuns.map(r => r.case_id));
    const sqlFailedCases = new Set(
      runs.filter(r => r.model_key === model.key && r.context_mode === 'warehouse_only' && r.outcome !== 'completed')
        .map(r => r.case_id)
    );
    const outcomeFlips = [...ctxCases].filter(c => sqlFailedCases.has(c)).length;

    const ctxTokens = avgTokens(ctxRuns);
    const sqlTokens = avgTokens(sqlRuns);
    const ctxDiscovery = avgDiscovery(ctxRuns);
    const sqlDiscovery = avgDiscovery(sqlRuns);

    boostScores[model.key] = {
      ctxEfficiency: avgEfficiency(ctxRuns),
      sqlEfficiency: avgEfficiency(sqlRuns),
      tokenReduction: ctxTokens !== null && sqlTokens !== null ? (sqlTokens - ctxTokens) / sqlTokens : null,
      discoveryCallReduction: ctxDiscovery !== null && sqlDiscovery !== null ? (sqlDiscovery - ctxDiscovery) / Math.max(sqlDiscovery, 1) : null,
      outcomeFlips,
    };
  }

  return NextResponse.json({
    runs,
    matrix,
    boostScores,
  });
}
