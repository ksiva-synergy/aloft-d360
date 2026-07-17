import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { archiveEntities, archiveDefinitions } from '@/lib/semantic/governance';
import { isAdmin } from '@/lib/semantic/promotion-gate';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/archive  (Phase 3.5A — now GATED)
 *
 * Archives entities or definitions (status = 'archived'). Previously UNGATED
 * (the other half of the RBAC hole this phase closes).
 *
 * Gate:
 *   - Admin (admin | platform_admin) → always allowed.
 *   - A non-admin may archive ONLY their OWN drafts (discard): every target
 *     row must be status 'draft' AND created_by === caller.
 *   - Archiving a candidate/governed definition is a governance action →
 *     admin-only in 3.5A. (Reputation-gating archive is a future refinement.)
 *
 * Entity path:     Body: { entityIds: string[] }
 * Definition path: Body: { definitionIds: string[], tableKind: 'dimension' | 'measure' }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const org = await getDefaultOrg();
    const { modelId } = await params;

    const body = (await request.json()) as {
      entityIds?: unknown;
      definitionIds?: unknown;
      tableKind?: unknown;
    };

    const hasEntityPath = Array.isArray(body.entityIds) && (body.entityIds as unknown[]).length > 0;
    const hasDefPath = Array.isArray(body.definitionIds) && (body.definitionIds as unknown[]).length > 0;

    if (hasEntityPath && hasDefPath) {
      return NextResponse.json({ error: 'specify entityIds OR definitionIds, not both' }, { status: 400 });
    }
    if (!hasEntityPath && !hasDefPath) {
      return NextResponse.json({ error: 'must provide entityIds or definitionIds' }, { status: 400 });
    }

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    let tableKind: 'dimension' | 'measure' | null = null;
    if (hasDefPath) {
      const tk = body.tableKind;
      if (tk !== 'dimension' && tk !== 'measure') {
        return NextResponse.json(
          { error: "tableKind must be 'dimension' or 'measure' when definitionIds is provided" },
          { status: 400 },
        );
      }
      tableKind = tk;
    }

    const ids = (hasEntityPath ? body.entityIds : body.definitionIds) as string[];

    // ── Authorization gate ────────────────────────────────────────────────────
    const admin = await isAdmin(currentUser.id);
    if (!admin) {
      const targets = await loadTargets(ids, tableKind, modelId, org.id);
      const ownDraftsOnly =
        targets.length > 0 &&
        targets.every((t) => t.status === 'draft' && t.created_by === currentUser.id);
      if (!ownDraftsOnly) {
        return NextResponse.json(
          { error: 'not authorized to archive — admins only, or the owner discarding their own draft' },
          { status: 403 },
        );
      }
    }

    const result = hasEntityPath
      ? await archiveEntities(ids, modelId, org.id, currentUser.id)
      : await archiveDefinitions(ids, tableKind!, modelId, org.id, currentUser.id);

    return NextResponse.json({ archived: result.succeeded, errors: result.errors });
  } catch (err) {
    console.error('[semantic/archive POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

interface TargetRow {
  id: string;
  status: string;
  created_by: string | null;
}

async function loadTargets(
  ids: string[],
  tableKind: 'dimension' | 'measure' | null,
  modelId: string,
  orgId: string,
): Promise<TargetRow[]> {
  if (tableKind === null) {
    return prisma.platform_sem_entities.findMany({
      where: { id: { in: ids }, model_id: modelId, org_id: orgId },
      select: { id: true, status: true, created_by: true },
    });
  }
  if (tableKind === 'dimension') {
    return prisma.platform_sem_dimensions.findMany({
      where: { id: { in: ids }, org_id: orgId, platform_sem_entities: { model_id: modelId } },
      select: { id: true, status: true, created_by: true },
    });
  }
  return prisma.platform_sem_measures.findMany({
    where: { id: { in: ids }, org_id: orgId, platform_sem_entities: { model_id: modelId } },
    select: { id: true, status: true, created_by: true },
  });
}
