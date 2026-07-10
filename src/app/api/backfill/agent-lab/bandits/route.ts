import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { posteriorComposite, computeBornProbs, ci95 } from '@/lib/bandits/born-math';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const windowDays = parseInt(searchParams.get('window') || '30', 10);
    const sheetTypeFilter = searchParams.get('sheetType') || null;
    const sourceFilter = searchParams.get('source') || null;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);

    const trendCutoff = new Date();
    trendCutoff.setDate(trendCutoff.getDate() - 7);

    const priorTrendStart = new Date();
    priorTrendStart.setDate(priorTrendStart.getDate() - 14);

    const tracesWhere: any = { created_at: { gte: cutoff } };
    if (sheetTypeFilter) tracesWhere.sheet_id = sheetTypeFilter;

    const modelWhere: any = { created_at: { gte: cutoff } };
    if (sheetTypeFilter) modelWhere.sheet_type = sheetTypeFilter;
    if (sourceFilter) modelWhere.source = sourceFilter;

    // ── bandit_observations query (new CTSGV source) ──────────────────────────
    const obsWhere: any = { created_at: { gte: cutoff } };
    if (sheetTypeFilter) obsWhere.sheet_type = { contains: sheetTypeFilter };
    if (sourceFilter && sourceFilter !== 'pipeline') obsWhere.source = sourceFilter;

    const [traces, modelRows, obsRows] = await Promise.all([
      prisma.backfill_agent_traces.findMany({
        where: tracesWhere,
        select: {
          id: true, job_id: true, agent_id: true, sheet_id: true, status: true,
          total_tokens: true, prompt_tokens: true, completion_tokens: true,
          total_duration_ms: true, tool_calls_count: true, retry_count: true,
          output_row_count: true, validation_passed: true, errors: true, created_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: 500,
      }),
      prisma.backfill_model_stats.findMany({
        where: modelWhere,
        orderBy: { created_at: 'desc' },
        take: 1000,
      }),
      (prisma as any).bandit_observations.findMany({
        where: obsWhere,
        orderBy: { created_at: 'desc' },
        take: 2000,
        select: {
          id: true, source: true, model_id: true, provider: true, sheet_type: true,
          score_c: true, score_t: true, score_s: true, score_g: true, score_v: true,
          composite_score: true, success: true,
          input_tokens: true, output_tokens: true, tool_calls_total: true,
          duration_ms: true, outcome: true, scored_at: true, created_at: true,
        },
      }) as Promise<Array<{
        id: string; source: string; model_id: string; provider: string; sheet_type: string;
        score_c: number | null; score_t: number | null; score_s: number | null;
        score_g: number | null; score_v: number | null;
        composite_score: number | null; success: boolean | null;
        input_tokens: number; output_tokens: number; tool_calls_total: number;
        duration_ms: number; outcome: string | null; scored_at: Date | null; created_at: Date | null;
      }>>,
    ]);

    // Aggregate agent stats by sheet_id
    const agentStatsMap: Record<string, {
      sheet_id: string; total: number; success: number; totalDuration: number;
      totalTokens: number; totalRetries: number; validationPassed: number;
      recent7d: number; recentSuccess7d: number; prior7d: number; priorSuccess7d: number;
    }> = {};

    for (const t of traces) {
      const sid = t.sheet_id ?? '';
      if (!agentStatsMap[sid]) {
        agentStatsMap[sid] = {
          sheet_id: sid, total: 0, success: 0, totalDuration: 0,
          totalTokens: 0, totalRetries: 0, validationPassed: 0,
          recent7d: 0, recentSuccess7d: 0, prior7d: 0, priorSuccess7d: 0,
        };
      }
      const a = agentStatsMap[sid];
      a.total++;
      if (t.status === 'success' || t.status === 'completed') a.success++;
      a.totalDuration += t.total_duration_ms ?? 0;
      a.totalTokens += t.total_tokens ?? 0;
      a.totalRetries += t.retry_count ?? 0;
      if (t.validation_passed) a.validationPassed++;

      const ts = t.created_at ? new Date(t.created_at) : null;
      if (ts) {
        if (ts >= trendCutoff) {
          a.recent7d++;
          if (t.status === 'success' || t.status === 'completed') a.recentSuccess7d++;
        } else if (ts >= priorTrendStart) {
          a.prior7d++;
          if (t.status === 'success' || t.status === 'completed') a.priorSuccess7d++;
        }
      }
    }

    const agentStats = Object.values(agentStatsMap).map(a => ({
      sheet_id: a.sheet_id,
      total_runs: a.total,
      success_rate: a.total > 0 ? Math.round((a.success / a.total) * 1000) / 1000 : 0,
      avg_duration_ms: a.total > 0 ? Math.round(a.totalDuration / a.total) : 0,
      avg_tokens: a.total > 0 ? Math.round(a.totalTokens / a.total) : 0,
      avg_retries: a.total > 0 ? Math.round((a.totalRetries / a.total) * 100) / 100 : 0,
      validation_rate: a.total > 0 ? Math.round((a.validationPassed / a.total) * 1000) / 1000 : 0,
      trend: (() => {
        const recentRate = a.recent7d > 0 ? a.recentSuccess7d / a.recent7d : 0;
        const priorRate = a.prior7d > 0 ? a.priorSuccess7d / a.prior7d : 0;
        return Math.round((recentRate - priorRate) * 1000) / 1000;
      })(),
    })).sort((a, b) => b.total_runs - a.total_runs);

    // ── CTSGV model stats from bandit_observations ────────────────────────────
    const obsStatsMap: Record<string, {
      model_id: string; provider: string; total: number; successes: number;
      totalComposite: number; compositeCount: number;
      totalC: number; cCount: number;
      totalT: number; tCount: number;
      totalS: number; sCount: number;
      totalG: number; gCount: number;
      totalV: number; vCount: number;
      totalDuration: number; scoredCount: number;
      sourceCounts: Record<string, number>;
      sheetBreakdown: Record<string, { total: number; success: number }>;
    }> = {};

    for (const obs of obsRows) {
      const key = obs.model_id ?? 'unknown';
      if (!obsStatsMap[key]) {
        obsStatsMap[key] = {
          model_id: key, provider: obs.provider ?? '',
          total: 0, successes: 0,
          totalComposite: 0, compositeCount: 0,
          totalC: 0, cCount: 0, totalT: 0, tCount: 0,
          totalS: 0, sCount: 0, totalG: 0, gCount: 0,
          totalV: 0, vCount: 0,
          totalDuration: 0, scoredCount: 0,
          sourceCounts: {}, sheetBreakdown: {},
        };
      }
      const m = obsStatsMap[key];
      m.total++;
      if (obs.success) m.successes++;
      if (obs.composite_score !== null) { m.totalComposite += obs.composite_score; m.compositeCount++; }
      if (obs.score_c !== null) { m.totalC += obs.score_c; m.cCount++; }
      if (obs.score_t !== null) { m.totalT += obs.score_t; m.tCount++; }
      if (obs.score_s !== null) { m.totalS += obs.score_s; m.sCount++; }
      if (obs.score_g !== null) { m.totalG += obs.score_g; m.gCount++; }
      if (obs.score_v !== null) { m.totalV += obs.score_v; m.vCount++; }
      if (obs.scored_at !== null) m.scoredCount++;
      m.totalDuration += obs.duration_ms ?? 0;
      const src = obs.source ?? 'unknown';
      m.sourceCounts[src] = (m.sourceCounts[src] || 0) + 1;
      const st = obs.sheet_type ?? '';
      if (!m.sheetBreakdown[st]) m.sheetBreakdown[st] = { total: 0, success: 0 };
      m.sheetBreakdown[st].total++;
      if (obs.success) m.sheetBreakdown[st].success++;
    }

    const ctsgvModelStats = Object.values(obsStatsMap).map(m => ({
      model_id: m.model_id,
      model_name: m.model_id,  // compat alias for components using model_name
      provider: m.provider,
      total_pulls: m.total,
      success_rate: m.total > 0 ? Math.round((m.successes / m.total) * 1000) / 1000 : 0,
      alpha: m.successes + 1,
      beta: (m.total - m.successes) + 1,
      phase: m.total < 5 ? 'exploring' : 'exploiting',
      avg_composite:  m.compositeCount > 0 ? Math.round((m.totalComposite / m.compositeCount) * 1000) / 1000 : null,
      avg_c:          m.cCount > 0 ? Math.round((m.totalC / m.cCount) * 1000) / 1000 : null,
      avg_t:          m.tCount > 0 ? Math.round((m.totalT / m.tCount) * 1000) / 1000 : null,
      avg_s:          m.sCount > 0 ? Math.round((m.totalS / m.sCount) * 1000) / 1000 : null,
      avg_g:          m.gCount > 0 ? Math.round((m.totalG / m.gCount) * 1000) / 1000 : null,
      avg_v:          m.vCount > 0 ? Math.round((m.totalV / m.vCount) * 1000) / 1000 : null,
      sg_coverage:    m.total > 0 ? Math.round((m.scoredCount / m.total) * 1000) / 1000 : 0,
      avg_quality_score: m.compositeCount > 0 ? Math.round((m.totalComposite / m.compositeCount) * 1000) / 1000 : null,
      avg_duration_ms: m.total > 0 ? Math.round(m.totalDuration / m.total) : 0,
      source_counts: m.sourceCounts,
      sheet_breakdown: Object.entries(m.sheetBreakdown).map(([st, v]) => ({
        sheet_type: st,
        total: v.total,
        success_rate: v.total > 0 ? Math.round((v.success / v.total) * 1000) / 1000 : 0,
      })),
    })).sort((a, b) => (b.avg_composite ?? 0) - (a.avg_composite ?? 0) || b.total_pulls - a.total_pulls);

    // ── BORN Phase 2: compute posterior arms & Thompson sampling probs ────────
    const posteriorArms = ctsgvModelStats.map(stat => posteriorComposite(stat as any));
    const { probs, entropy } = computeBornProbs(posteriorArms, 8000);

    ctsgvModelStats.forEach((stat: any, i: number) => {
      const { alpha, beta } = posteriorArms[i];
      const [lo, hi] = ci95(alpha, beta);
      stat.born_prob       = probs[i];
      stat.next_draw_prob  = probs[i];
      stat.ci_low          = lo;
      stat.ci_high         = hi;
      stat.posterior_alpha = alpha;
      stat.posterior_beta  = beta;
    });

    const favIdx = probs.indexOf(Math.max(...probs));
    const bornTopLevel = {
      born_probs:      probs,
      belief_entropy:  entropy,
      favourite_model: ctsgvModelStats[favIdx]?.model_id ?? '',
      favourite_prob:  probs[favIdx] ?? 0,
      exploration_pct: ctsgvModelStats.filter((s: any) => s.phase === 'exploring').length / ctsgvModelStats.length,
    };

    // ── Legacy model stats from backfill_model_stats (pipeline source) ────────
    const modelStatsMap: Record<string, {
      model_name: string; provider: string; total: number; success: number;
      totalDuration: number; sheetBreakdown: Record<string, { total: number; success: number }>;
      sourceCounts: Record<string, number>;
      totalQuality: number; qualityCount: number;
    }> = {};

    for (const r of modelRows) {
      const key = r.model_name ?? 'unknown';
      if (!modelStatsMap[key]) {
        modelStatsMap[key] = {
          model_name: r.model_name ?? 'unknown', provider: r.provider ?? '',
          total: 0, success: 0, totalDuration: 0, sheetBreakdown: {},
          sourceCounts: {},
          totalQuality: 0, qualityCount: 0,
        };
      }
      const m = modelStatsMap[key];
      m.total++;
      if (r.success) m.success++;
      m.totalDuration += r.duration_ms ?? 0;

      const qs = (r as any).quality_score;
      if (qs != null) {
        m.totalQuality += qs;
        m.qualityCount++;
      }

      const src = r.source ?? 'pipeline';
      m.sourceCounts[src] = (m.sourceCounts[src] || 0) + 1;

      const sheetType = r.sheet_type ?? '';
      if (!m.sheetBreakdown[sheetType]) {
        m.sheetBreakdown[sheetType] = { total: 0, success: 0 };
      }
      m.sheetBreakdown[sheetType].total++;
      if (r.success) m.sheetBreakdown[sheetType].success++;
    }

    const modelStats = Object.values(modelStatsMap).map(m => ({
      model_name: m.model_name,
      provider: m.provider,
      total_pulls: m.total,
      success_rate: m.total > 0 ? Math.round((m.success / m.total) * 1000) / 1000 : 0,
      avg_duration_ms: m.total > 0 ? Math.round(m.totalDuration / m.total) : 0,
      alpha: m.success + 1,
      beta: (m.total - m.success) + 1,
      phase: m.total < 5 ? 'exploring' : 'exploiting',
      source_counts: m.sourceCounts,
      avg_quality_score: m.qualityCount > 0 ? Math.round((m.totalQuality / m.qualityCount) * 1000) / 1000 : null,
      sheet_breakdown: Object.entries(m.sheetBreakdown).map(([st, v]) => ({
        sheet_type: st,
        total: v.total,
        success_rate: v.total > 0 ? Math.round((v.success / v.total) * 1000) / 1000 : 0,
      })),
    })).sort((a, b) => b.success_rate - a.success_rate || b.total_pulls - a.total_pulls);

    const jobSourceMap: Record<string, string> = {};
    for (const r of modelRows) {
      if (r.job_id && r.source) {
        jobSourceMap[r.job_id] = r.source;
      }
    }

    // Pipeline traces-based runs (existing behaviour)
    const traceRuns = traces.slice(0, 50).map(t => ({
      id: t.id,
      job_id: t.job_id,
      agent_id: t.agent_id,
      sheet_id: t.sheet_id,
      status: t.status,
      total_tokens: t.total_tokens,
      total_duration_ms: t.total_duration_ms,
      output_row_count: t.output_row_count,
      validation_passed: t.validation_passed,
      retry_count: t.retry_count,
      created_at: t.created_at,
      source: t.job_id ? (jobSourceMap[t.job_id] || 'pipeline') : 'pipeline',
    }));

    // Inspector and workbench runs come from backfill_model_stats directly
    const surfaceRuns = modelRows
      .filter(r => r.source === 'inspector' || r.source === 'workbench')
      .slice(0, 50)
      .map(r => ({
        id: r.id,
        job_id: null,
        agent_id: r.source === 'inspector' ? 'inspector' : 'workbench',
        sheet_id: r.sheet_type,
        status: r.success ? 'completed' : 'failed',
        total_tokens: null,
        total_duration_ms: r.duration_ms,
        output_row_count: r.row_count,
        validation_passed: r.success,
        retry_count: 0,
        created_at: r.created_at,
        source: r.source as string,
        quality_score: (r as any).quality_score ?? null,
      }));

    // CTSGV observations (inspector, workbench, boost)
    const obsRuns = obsRows.slice(0, 100).map(obs => ({
      id: obs.id,
      job_id: null,
      agent_id: obs.model_id,
      sheet_id: obs.sheet_type,
      status: obs.success ? 'completed' : (obs.outcome ?? 'unknown'),
      total_tokens: obs.input_tokens + obs.output_tokens,
      total_duration_ms: obs.duration_ms,
      output_row_count: null,
      validation_passed: obs.success,
      retry_count: 0,
      created_at: obs.created_at,
      source: obs.source,
      composite_score: obs.composite_score,
      score_c: obs.score_c,
      score_t: obs.score_t,
      score_s: obs.score_s,
      score_g: obs.score_g,
      input_tokens: obs.input_tokens,
      output_tokens: obs.output_tokens,
      duration_ms: obs.duration_ms,
      groundedness_mode: obs.score_g !== null ? 'scored' : 'pending',
      sg_scored: obs.scored_at !== null,
    }));

    // Merge and sort by created_at descending, take 50
    const recentRuns = [...traceRuns, ...surfaceRuns, ...obsRuns]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      })
      .slice(0, 50);

    const dailyCostMap: Record<string, { date: string; prompt_tokens: number; completion_tokens: number; total_tokens: number }> = {};
    for (const t of traces) {
      const day = t.created_at?.toISOString().substring(0, 10);
      if (!day) continue;
      if (!dailyCostMap[day]) {
        dailyCostMap[day] = { date: day, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      }
      dailyCostMap[day].prompt_tokens += t.prompt_tokens ?? 0;
      dailyCostMap[day].completion_tokens += t.completion_tokens ?? 0;
      dailyCostMap[day].total_tokens += t.total_tokens ?? 0;
    }
    const costSeries = Object.values(dailyCostMap).sort((a, b) => a.date.localeCompare(b.date));

    const allocMap: Record<string, Record<string, number>> = {};
    for (const obs of obsRows) {
      const day = obs.created_at?.toISOString().substring(0, 10);
      if (!day) continue;
      if (!allocMap[day]) allocMap[day] = {};
      const mn = obs.model_id ?? 'unknown';
      allocMap[day][mn] = (allocMap[day][mn] || 0) + 1;
    }
    // Also include legacy model rows in allocation
    for (const r of modelRows) {
      const day = r.created_at?.toISOString().substring(0, 10);
      if (!day) continue;
      if (!allocMap[day]) allocMap[day] = {};
      const mn = r.model_name ?? 'unknown';
      allocMap[day][mn] = (allocMap[day][mn] || 0) + 1;
    }
    const allModels = [...new Set([
      ...obsRows.map(o => o.model_id ?? 'unknown'),
      ...modelRows.map(r => r.model_name ?? 'unknown'),
    ])];
    const allocationSeries = Object.entries(allocMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date,
        ...Object.fromEntries(allModels.map(m => [m, counts[m] || 0])),
      }));

    return NextResponse.json({
      agentStats,
      modelStats,           // legacy pipeline stats (backfill_model_stats)
      ctsgvModelStats,      // new CTSGV stats (bandit_observations)
      recentRuns,
      costSeries,
      allocationSeries,
      allModels,
      totalTraces: traces.length,
      totalModelPulls: modelRows.length,
      totalObservations: obsRows.length,
      window: windowDays,
      ...bornTopLevel,
    });
  } catch (error: any) {
    console.error('[bandits API]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

