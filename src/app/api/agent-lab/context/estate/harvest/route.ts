import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const paths: string[] = body.paths;

  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ error: 'MISSING_PATHS' }, { status: 400 });
  }

  try {
    const orgId = await getOrgId();

    const enqueued: string[] = [];
    const skipped: { path: string; reason: string }[] = [];

    for (const path of paths) {
      const estateRow = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, source_id, harvest_state
         FROM platform_estate_objects
         WHERE org_id = $1 AND full_path = $2 AND lifecycle = 'active'
         LIMIT 1`,
        orgId,
        path,
      );

      if (estateRow.length === 0) {
        skipped.push({ path, reason: 'not_found' });
        continue;
      }

      const row = estateRow[0];

      if (row.harvest_state === 'queued' || row.harvest_state === 'harvested') {
        skipped.push({ path, reason: 'already_queued' });
        continue;
      }

      if (row.harvest_state === 'inaccessible') {
        skipped.push({ path, reason: 'inaccessible' });
        continue;
      }

      const sourceId = row.source_id;
      if (!sourceId) {
        skipped.push({ path, reason: 'no_source' });
        continue;
      }

      await enqueue('t0_structural', sourceId, { path }, 'on_demand', orgId);

      await prisma.$executeRawUnsafe(
        `UPDATE platform_estate_objects SET harvest_state = 'queued'
         WHERE org_id = $1 AND full_path = $2`,
        orgId,
        path,
      );

      enqueued.push(path);
    }

    return NextResponse.json({ enqueued, skipped });
  } catch (err) {
    console.error('[context/estate/harvest POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
