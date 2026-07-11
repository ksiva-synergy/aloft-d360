import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { BOOST_SUITE_V1, BOOST_SUITE_V2 } from '@/lib/boost/suite';
import { scoreGroundedness } from '@/lib/boost/scorers/groundedness';
import { scoreSemanticQuality } from '@/lib/boost/scorers/semantic';
import { recomputeCtsgv } from '@/lib/lifecycle/score-ctsgv';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json() as { runIds?: string[]; rescoreAll?: boolean };
  const { runIds, rescoreAll } = body;

  let runs: Awaited<ReturnType<typeof prisma.platform_boost_runs.findMany>>;

  if (runIds && runIds.length > 0) {
    runs = await prisma.platform_boost_runs.findMany({ where: { id: { in: runIds } } });
  } else if (rescoreAll) {
    runs = await prisma.platform_boost_runs.findMany({
      where: {
        OR: [{ groundedness: null }, { semantic_score: null }],
      },
    });
  } else {
    runs = await prisma.platform_boost_runs.findMany({
      where: {
        OR: [{ groundedness: null }, { semantic_score: null }],
      },
    });
  }

  let scored = 0;
  let skipped = 0;
  let errors = 0;
  const results: { id: string; groundedness: number | null; semantic_score: number | null }[] = [];

  const ALL_CASES = [...BOOST_SUITE_V1, ...BOOST_SUITE_V2];

  for (const run of runs) {
    if (run.outcome === 'errored' || run.outcome === 'incompatible') {
      skipped++;
      continue;
    }

    const boostCase = ALL_CASES.find(c => c.id === run.case_id);
    if (!boostCase) {
      skipped++;
      continue;
    }

    console.log(`Scoring run ${run.id} (${run.model_key} × ${run.context_mode} × ${run.case_id})...`);

    try {
      const groundednessResult = await scoreGroundedness({
        answerExcerpt: run.answer_excerpt,
        answerFull: run.answer_full,
        toolTrajectory: (run.tool_trajectory as unknown[]) ?? [],
        mode: boostCase.groundednessMode ?? 'phantom_trace',
      });

      const semanticResult = await scoreSemanticQuality({
        answerExcerpt: run.answer_excerpt,
        answerFull: run.answer_full,
        boostCase,
        toolTrajectory: (run.tool_trajectory as unknown[]) ?? [],
      });

      const groundednessScore = groundednessResult?.score ?? null;
      const semanticScore = semanticResult?.composite ?? null;
      const semanticDetail = semanticResult
        ? { ...semanticResult, groundedness_detail: groundednessResult?.detail ?? null }
        : (groundednessResult?.detail ? { groundedness_detail: groundednessResult.detail } : null);

      await prisma.platform_boost_runs.update({
        where: { id: run.id },
        data: {
          groundedness: groundednessScore,
          semantic_score: semanticScore,
          semantic_detail: semanticDetail ? (semanticDetail as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      // Also update the corresponding bandit_observations row with refined CTSGV
      if (groundednessScore !== null || semanticScore !== null) {
        const obs = await (prisma as any).bandit_observations.findUnique({
          where: { source_run_id: run.id },
          select: {
            id: true, input_tokens: true, output_tokens: true,
            tool_calls_total: true, tool_calls_error: true, tool_calls_discovery: true,
            score_v: true, outcome: true,
          },
        });
        if (obs) {
          const { composite, success } = recomputeCtsgv({
            input_tokens: obs.input_tokens,
            output_tokens: obs.output_tokens,
            tool_calls_total: obs.tool_calls_total,
            tool_calls_error: obs.tool_calls_error,
            tool_calls_discovery: obs.tool_calls_discovery,
            score_s: semanticScore,
            score_g: groundednessScore,
            score_v: obs.score_v,
            outcome: obs.outcome,
          });
          await (prisma as any).bandit_observations.update({
            where: { id: obs.id },
            data: {
              score_s:         semanticScore,
              score_g:         groundednessScore,
              composite_score: composite,
              success,
              scored_at:       new Date(),
              judge_model:     'us.anthropic.claude-sonnet-4-6',
            },
          });
        }
      }

      scored++;
      results.push({ id: run.id, groundedness: groundednessScore, semantic_score: semanticScore });
    } catch (err) {
      errors++;
      console.error(`Failed to score run ${run.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ scored, skipped, errors, results });
}
