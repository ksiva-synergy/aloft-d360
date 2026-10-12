import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  generateStudioInsights,
  INSIGHTS_PROMPT_VERSION,
  type InsightItem,
  type InsightResult,
} from '@/lib/studio/insights';
import { computeCostUsd } from '@/lib/lifecycle/log-agent-cost';
import type { ColumnProfile } from '@/lib/studio/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function assertResultAccess(resultId: string, userId: string): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; status: number; error: string }
> {
  const result = await prisma.studio_query_results.findUnique({
    where: { id: resultId },
    select: {
      session_id: true,
      session: { select: { user_id: true } },
    },
  });

  if (!result) {
    return { ok: false, status: 404, error: 'Result not found' };
  }

  const ownerId = result.session.user_id;
  if (ownerId && ownerId !== userId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, sessionId: result.session_id };
}

function asInsightItems(json: unknown): InsightItem[] {
  if (!Array.isArray(json)) return [];
  return json as InsightItem[];
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const resultId = request.nextUrl.searchParams.get('resultId');
  if (!resultId) {
    return NextResponse.json({ error: 'resultId required' }, { status: 400 });
  }

  const access = await assertResultAccess(resultId, session.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const row = await prisma.studio_insights.findUnique({
      where: { result_id: resultId },
      select: { insights: true },
    });

    if (!row) {
      return NextResponse.json({ insights: [] } satisfies InsightResult);
    }

    return NextResponse.json({
      insights: asInsightItems(row.insights),
    } satisfies InsightResult);
  } catch (err) {
    console.error('[studio/insights GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      sql?: string;
      profiles?: ColumnProfile[];
      specs?: Array<{ kind: string; rationale: string; x?: string; y?: string | string[] }>;
      sampleRows?: Record<string, unknown>[];
      resultId?: string;
    };

    const sql = typeof body.sql === 'string' ? body.sql : '';
    const profiles = Array.isArray(body.profiles) ? body.profiles : [];
    const specs = Array.isArray(body.specs) ? body.specs : [];
    const sampleRows = Array.isArray(body.sampleRows) ? body.sampleRows : [];
    const resultId = typeof body.resultId === 'string' ? body.resultId : undefined;

    if (!sql || profiles.length === 0) {
      return NextResponse.json(
        { error: 'sql and profiles are required' },
        { status: 400 },
      );
    }

    let sessionId: string | undefined;
    if (resultId) {
      const access = await assertResultAccess(resultId, session.user.id);
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status });
      }
      sessionId = access.sessionId;
    }

    const generated = await generateStudioInsights({
      sql,
      profiles,
      specs,
      sampleRows,
    });

    if (resultId && sessionId) {
      const costUsd = computeCostUsd(
        generated.model,
        generated.inputTokens,
        generated.outputTokens,
      );

      const insightsJson = generated.insights as unknown as Prisma.InputJsonValue;

      await prisma.studio_insights.upsert({
        where: { result_id: resultId },
        create: {
          result_id: resultId,
          session_id: sessionId,
          insights: insightsJson,
          prompt_version: INSIGHTS_PROMPT_VERSION,
          model: generated.model,
          input_tokens: generated.inputTokens,
          output_tokens: generated.outputTokens,
          cost_usd: costUsd,
          duration_ms: generated.durationMs,
        },
        update: {
          insights: insightsJson,
          prompt_version: INSIGHTS_PROMPT_VERSION,
          model: generated.model,
          input_tokens: generated.inputTokens,
          output_tokens: generated.outputTokens,
          cost_usd: costUsd,
          duration_ms: generated.durationMs,
        },
      });
    }

    return NextResponse.json({
      insights: generated.insights,
    } satisfies InsightResult);
  } catch (err) {
    console.error('[studio/insights POST]', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
