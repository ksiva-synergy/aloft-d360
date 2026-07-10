import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { getOrgId } from '@/lib/databricks/connections';
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-lab/context/estate/sync-knowledge
 * Object-scoped knowledge sync — enqueues a knowledge_sync job for each path.
 * Only acts on objects that are already harvested (have a context_object row).
 */
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
      const contextRow = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, source_id
         FROM platform_context_objects
         WHERE org_id = $1 AND full_path = $2 AND lifecycle = 'active'
         LIMIT 1`,
        orgId,
        path,
      );

      if (contextRow.length === 0) {
        skipped.push({ path, reason: 'not_harvested' });
        continue;
      }

      const row = contextRow[0];

      await enqueue('knowledge_sync', row.source_id, { path, context_object_id: row.id }, 'on_demand', orgId);
      enqueued.push(path);
    }

    return NextResponse.json({ enqueued, skipped });
  } catch (err) {
    console.error('[context/estate/sync-knowledge POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
