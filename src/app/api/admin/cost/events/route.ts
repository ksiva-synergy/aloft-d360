import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSection } from '@/lib/sections/server';
import { getOrgId } from '@/lib/databricks/connections';
import { fetchSpendEvents } from '@/lib/spend/cost-queries';

export const dynamic = 'force-dynamic';

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSection(null, ['govern.cost', 'view']);
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const sp = req.nextUrl.searchParams;
    const days = Math.min(90, Math.max(1, parseInt(sp.get('days') ?? '30', 10) || 30));
    const limit = Math.min(5000, Math.max(1, parseInt(sp.get('limit') ?? '500', 10) || 500));
    const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
    const str = (k: string) => {
      const v = sp.get(k)?.trim();
      return v ? v.slice(0, 200) : undefined;
    };
    const bucket = str('bucket');
    const userId = str('userId');
    const surface = str('surface');
    const model = str('model');
    const jobKind = str('jobKind');
    const q = str('q');
    const sort = sp.get('sort') === 'cost' ? 'cost' : 'recent';
    const format = sp.get('format');

    const data = await fetchSpendEvents(orgId, {
      bucket,
      userId,
      surface,
      model,
      jobKind,
      q,
      sort,
      days,
      limit,
      offset,
    });

    if (format === 'csv') {
      const header = [
        'occurred_at',
        'bucket',
        'surface',
        'action',
        'usd',
        'user_email',
        'model',
        'job_kind',
        'agent_slug',
        'session_id',
        'job_id',
        'status',
        'input_tokens',
        'output_tokens',
        'cache_read_tokens',
        'cache_write_tokens',
      ].join(',');
      const lines = data.events.map((e) =>
        [
          e.occurredAt,
          e.bucket,
          e.surface,
          e.action,
          String(e.usd),
          e.userEmail ?? '',
          e.model ?? '',
          e.jobKind ?? '',
          e.agentSlug ?? '',
          e.sessionId ?? '',
          e.jobId ?? '',
          e.status ?? '',
          String(e.inputTokens),
          String(e.outputTokens),
          String(e.cacheReadTokens),
          String(e.cacheWriteTokens),
        ]
          .map((c) => csvEscape(String(c)))
          .join(','),
      );
      const body = [header, ...lines].join('\n');
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="spend-events-${days}d.csv"`,
        },
      });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/cost/events]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load spend events' },
      { status: 500 },
    );
  }
}
