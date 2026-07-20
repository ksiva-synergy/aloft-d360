import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/models  (W1 — standalone Metrics route)
 *
 * Lists the org's semantic models (id, name, status) for the standalone route's
 * model picker (authoring target) and governance queue. `defaultModelId` follows
 * the same resolution the Inspector chat / dashboards POST use: prefer the latest
 * governed model, else the latest candidate — so the route lands on a sensible
 * model with entities to author against.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;
    const currentUser = email ? await getUserByEmail(email) : null;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();

    const models = await prisma.platform_semantic_models.findMany({
      where: { org_id: org.id },
      select: { id: true, name: true, status: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });

    // Resolution order: latest governed → latest candidate → latest anything.
    const governed = models.find((m) => m.status === 'governed');
    const candidate = models.find((m) => m.status === 'candidate');
    const defaultModelId = (governed ?? candidate ?? models[0])?.id ?? null;

    return NextResponse.json({
      models: models.map((m) => ({ id: m.id, name: m.name, status: m.status })),
      defaultModelId,
    });
  } catch (err) {
    console.error('[semantic/models GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
