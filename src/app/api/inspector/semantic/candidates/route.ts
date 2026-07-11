import { NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/candidates
 *
 * Returns { exists: boolean, modelId: string | null }.
 * One Prisma query — no entity data loaded.
 * Used by InspectorShell to decide whether to show the Semantic tab.
 */
export async function GET() {
  try {
    const org = await getDefaultOrg();
    const model = await prisma.platform_semantic_models.findFirst({
      where: { org_id: org.id, status: 'candidate' },
      select: { id: true },
      orderBy: { created_at: 'desc' },
    });
    return NextResponse.json({ exists: model !== null, modelId: model?.id ?? null });
  } catch (err) {
    console.error('[semantic/candidates GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
