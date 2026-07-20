import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { promoteEntities, promoteDefinitions } from '@/lib/semantic/governance';
import {
  isAdmin,
  evaluatePromotionEligibility,
  creditAuthoringPromotion,
  selectAuthoringCreditRecipients,
} from '@/lib/semantic/promotion-gate';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/promote  (Phase 3.5A — now GATED)
 *
 * Promotes candidates to 'governed' (the candidate → governed rung). Previously
 * UNGATED (any caller could promote — the RBAC hole this phase closes).
 *
 * Gate (candidate → governed):
 *   - Admin (admin | platform_admin) → always allowed (admin override).
 *   - Contributor self-approve: the caller is the created_by author of EVERY
 *     row AND their semantic_authoring reputation clears the self-approve bar.
 *     Day one, everyone is provisional, so this never fires for non-admins.
 *   - Otherwise → 403 (needs admin approval; multi-approver quorum tables are
 *     deferred until non-admin authoring reputation exists — Phase 3.5A scope).
 *
 * Ladder guard: only 'candidate' rows may be promoted here. A 'draft' must
 * first be submitted (draft → candidate) via /submit; promoting a draft
 * straight to governed would skip the candidate rung and is rejected (400).
 *
 * On success the row's author (created_by) is credited in the
 * semantic_authoring reputation domain — closing the trust loop.
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

    // ── Load target rows (status + author) for the ladder guard + gate ────────
    const targets = await loadTargets(ids, tableKind, modelId, org.id);

    // ── Authorization gate ────────────────────────────────────────────────────
    const admin = await isAdmin(currentUser.id);
    if (!admin) {
      // Ladder guard: drafts cannot be promoted directly to governed.
      const draftIds = targets.filter((t) => t.status === 'draft').map((t) => t.id);
      if (draftIds.length > 0) {
        return NextResponse.json(
          { error: `submit for governance first — these are still drafts: ${draftIds.join(', ')}` },
          { status: 400 },
        );
      }

      // Self-approve requires: caller authored EVERY target row AND their
      // semantic_authoring reputation clears the self-approve bar.
      const authoredByCaller =
        targets.length > 0 && targets.every((t) => t.created_by === currentUser.id);
      const eligibility = await evaluatePromotionEligibility(currentUser.id, org.id);

      if (!(authoredByCaller && eligibility.canSelfApprove)) {
        return NextResponse.json(
          {
            error: 'not authorized to promote — requires admin approval',
            reason: authoredByCaller
              ? eligibility.reason
              : 'you are not the author of every candidate being promoted',
          },
          { status: 403 },
        );
      }
    }

    // ── Promote ────────────────────────────────────────────────────────────────
    const result = hasEntityPath
      ? await promoteEntities(ids, modelId, org.id, currentUser.id)
      : await promoteDefinitions(ids, tableKind!, modelId, org.id, currentUser.id);

    // ── Credit the AUTHOR of each successfully-promoted row (trust loop) ────────
    // Recipient selection is the row author, never the caller — factored into
    // selectAuthoringCreditRecipients so that property is unit-tested.
    const authors = selectAuthoringCreditRecipients(targets, result.succeeded);
    for (const authorId of authors) {
      await creditAuthoringPromotion(org.id, authorId);
    }

    return NextResponse.json({ promoted: result.succeeded, errors: result.errors });
  } catch (err) {
    console.error('[semantic/promote POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

interface TargetRow {
  id: string;
  status: string;
  created_by: string | null;
}

/** Load {id, status, created_by} for the rows being promoted, scoped to the model. */
async function loadTargets(
  ids: string[],
  tableKind: 'dimension' | 'measure' | null,
  modelId: string,
  orgId: string,
): Promise<TargetRow[]> {
  if (tableKind === null) {
    const rows = await prisma.platform_sem_entities.findMany({
      where: { id: { in: ids }, model_id: modelId, org_id: orgId },
      select: { id: true, status: true, created_by: true },
    });
    return rows;
  }
  if (tableKind === 'dimension') {
    const rows = await prisma.platform_sem_dimensions.findMany({
      where: { id: { in: ids }, org_id: orgId, platform_sem_entities: { model_id: modelId } },
      select: { id: true, status: true, created_by: true },
    });
    return rows;
  }
  const rows = await prisma.platform_sem_measures.findMany({
    where: { id: { in: ids }, org_id: orgId, platform_sem_entities: { model_id: modelId } },
    select: { id: true, status: true, created_by: true },
  });
  return rows;
}
