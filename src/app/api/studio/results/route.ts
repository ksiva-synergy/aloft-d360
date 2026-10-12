import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isUniqueSessionSeqError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  );
}

async function nextResultSeq(sessionId: string): Promise<number> {
  const agg = await prisma.studio_query_results.aggregate({
    where: { session_id: sessionId },
    _max: { seq: true },
  });
  return (agg._max.seq ?? -1) + 1;
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  try {
    const results = await prisma.studio_query_results.findMany({
      where: { session_id: sessionId },
      orderBy: { seq: 'asc' },
    });

    return NextResponse.json({
      results: results.map(r => ({
        id: r.id,
        seq: r.seq,
        sql: r.sql,
        columns: r.columns,
        rows: r.rows,
        row_count: r.row_count,
        truncated: r.truncated,
        profiles: r.profiles,
        specs: r.specs,
        chart_overrides: r.chart_overrides,
        active_result_index: r.active_result_index,
      })),
    });
  } catch (err) {
    console.error('[studio/results GET] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, sql, columns, rows, rowCount, truncated } = body;

    if (!sessionId || !sql) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let seq = await nextResultSeq(sessionId);
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await prisma.studio_query_results.create({
          data: {
            session_id: sessionId,
            seq,
            sql,
            columns,
            rows,
            row_count: rowCount ?? 0,
            truncated: truncated ?? false,
          },
        });
        break;
      } catch (err) {
        if (!isUniqueSessionSeqError(err) || attempt === 2) {
          throw err;
        }
        seq = await nextResultSeq(sessionId);
      }
    }

    return NextResponse.json({ id: result!.id, seq: result!.seq });
  } catch (err) {
    console.error('[studio/results POST] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.profiles !== undefined) updates.profiles = body.profiles;
    if (body.specs !== undefined) updates.specs = body.specs;
    if (body.chart_overrides !== undefined) updates.chart_overrides = body.chart_overrides;
    if (body.active_result_index !== undefined) updates.active_result_index = body.active_result_index;

    await prisma.studio_query_results.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[studio/results PATCH] error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
