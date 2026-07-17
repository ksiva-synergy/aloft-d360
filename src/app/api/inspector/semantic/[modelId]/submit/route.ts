import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { submitEntities, submitDefinitions } from '@/lib/semantic/governance';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/submit  (Phase 3.5A)
 *
 * "Submit for governance" — the draft → candidate rung of the promotion ladder.
 * Makes an owner's personal drafts org-visible and puts them in the review
 * queue. There is NO reputation gate on submission: anyone may submit their OWN
 * drafts. Reputation gates only the next hop (candidate → governed, /promote).
 *
 * Body: { definitionIds: string[], tableKind: 'entity' | 'dimension' | 'measure' }
 *
 * Guard: the caller must be the created_by OWNER of every submitted row. A user
 * can only submit their own drafts (403 otherwise).
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

    const body = (await request.json()) as { definitionIds?: unknown; tableKind?: unknown };
    const tableKind = body.tableKind;
    if (tableKind !== 'entity' && tableKind !== 'dimension' && tableKind !== 'measure') {
      return NextResponse.json(
        { error: "tableKind must be 'entity', 'dimension', or 'measure'" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.definitionIds) || body.definitionIds.length === 0) {
      return NextResponse.json({ error: 'definitionIds must be a non-empty array' }, { status: 400 });
    }
    const ids = body.definitionIds as string[];

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    // ── Ownership guard: caller must own (created_by) every submitted row ─────
    const ownership = await verifyOwnership(ids, tableKind, modelId, org.id, currentUser.id);
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.reason }, { status: ownership.status });
    }

    const result = tableKind === 'entity'
      ? await submitEntities(ids, modelId, org.id, currentUser.id)
      : await submitDefinitions(ids, tableKind, modelId, org.id, currentUser.id);

    return NextResponse.json({ submitted: result.succeeded, errors: result.errors });
  } catch (err) {
    console.error('[semantic/submit POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Every id must resolve within this model and be owned by the caller
 * (created_by === userId). A row owned by someone else, a system/T4 row
 * (created_by NULL), or a missing row fails the guard with 403 / 404.
 */
async function verifyOwnership(
  ids: string[],
  tableKind: 'entity' | 'dimension' | 'measure',
  modelId: string,
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  for (const id of ids) {
    let createdBy: string | null | undefined;
    let inModel = false;

    if (tableKind === 'entity') {
      const row = await prisma.platform_sem_entities.findFirst({
        where: { id, model_id: modelId, org_id: orgId },
        select: { created_by: true },
      });
      if (row) { inModel = true; createdBy = row.created_by; }
    } else if (tableKind === 'dimension') {
      const row = await prisma.platform_sem_dimensions.findFirst({
        where: { id, org_id: orgId },
        select: { created_by: true, platform_sem_entities: { select: { model_id: true } } },
      });
      if (row && row.platform_sem_entities.model_id === modelId) { inModel = true; createdBy = row.created_by; }
    } else {
      const row = await prisma.platform_sem_measures.findFirst({
        where: { id, org_id: orgId },
        select: { created_by: true, platform_sem_entities: { select: { model_id: true } } },
      });
      if (row && row.platform_sem_entities.model_id === modelId) { inModel = true; createdBy = row.created_by; }
    }

    if (!inModel) {
      return { ok: false, status: 404, reason: `${tableKind} '${id}' not found in this model` };
    }
    if (createdBy !== userId) {
      return {
        ok: false,
        status: 403,
        reason: `you may only submit your own drafts — ${tableKind} '${id}' is not yours`,
      };
    }
  }
  return { ok: true };
}
