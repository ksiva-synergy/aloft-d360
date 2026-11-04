import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessSessionRole } from '@/middleware/auth';
import { getOrgId } from '@/lib/databricks/connections';
import { fetchSpendEvents } from '@/lib/spend/cost-queries';

export const dynamic = 'force-dynamic';

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(req: NextRequest) {
  const denied = await denyUnlessSessionRole('admin');
  if (denied) return denied;

  try {
    const orgId = await getOrgId();
    const sp = req.nextUrl.searchParams;
    const days = Math.min(90, Math.max(1, parseInt(sp.get('days') ?? '30', 10) || 30));
    const limit = Math.min(5000, Math.max(1, parseInt(sp.get('limit') ?? '500', 10) || 500));
    const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
    const bucket = sp.get('bucket') ?? undefined;
    const userId = sp.get('userId') ?? undefined;
    const format = sp.get('format');

    const data = await fetchSpendEvents(orgId, { bucket, userId, days, limit, offset });

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
