import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { writeAuditRow } from '@/lib/semantic/governance';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

// Valid trust-status transitions — forward only, no backward, no skip.
const VALID_TRANSITIONS: Record<string, string> = {
  assumed:   'confirmed',
  confirmed: 'certified',
};

/**
 * POST /api/agent-lab/context/objects/[id]/confirm-semantic
 *
 * Advances a semantic card's trust status (assumed → confirmed → certified).
 *
 * Body: { semanticCardId: string, status: 'confirmed' | 'certified' }
 *
 * Version guard: the semanticCardId must be the current latest version for this
 * object. If a re-enrich ran after page load, returns 409 VERSION_SUPERSEDED so
 * the steward can refresh and review the new card before confirming.
 *
 * Audit trail: writes to platform_sem_audit via writeAuditRow() (same pattern as
 * T4 entity promotion) when a T4 entity model exists for this object. If no T4 model
 * exists yet, the status update is still persisted but no audit row is written
 * (FK constraint on platform_sem_audit.model_id prevents writing without a model).
 * This constraint is documented in PHASE_DS3A_DECISIONS.md.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id: objectId } = await params;
  if (!objectId) {
    return NextResponse.json({ error: 'BAD_REQUEST', field: 'id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { semanticCardId, status: requestedStatus } = body;

  if (!semanticCardId) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'semanticCardId', message: 'semanticCardId is required' },
      { status: 400 },
    );
  }
  if (!requestedStatus || !['confirmed', 'certified'].includes(requestedStatus)) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'status', message: 'status must be confirmed or certified' },
      { status: 400 },
    );
  }

  try {
    const org = await getDefaultOrg();
    const orgId = org.id;

    // 1. Verify the object exists and belongs to this org
    const object = await prisma.platformContextObject.findFirst({
      where: { id: objectId, org_id: orgId },
      select: { id: true, full_path: true },
    });
    if (!object) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // 2. Fetch the specific semantic card by ID (not by "latest")
    const card = await prisma.platformContextSemantic.findFirst({
      where: { id: semanticCardId, subject_id: objectId, subject_kind: 'object', org_id: orgId },
    });
    if (!card) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Semantic card not found for this object' },
        { status: 404 },
      );
    }

    // 3. Version guard — check if a newer version now exists
    const newerCard = await prisma.platformContextSemantic.findFirst({
      where: {
        subject_kind: 'object',
        subject_id: objectId,
        org_id: orgId,
        version: { gt: card.version },
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    if (newerCard) {
      return NextResponse.json(
        {
          error: 'VERSION_SUPERSEDED',
          message: 'A newer version of this card exists — refresh the page to review the latest version before confirming',
          latestVersion: newerCard.version,
        },
        { status: 409 },
      );
    }

    // 4. Validate transition order
    const expectedNext = VALID_TRANSITIONS[card.status];
    if (expectedNext !== requestedStatus) {
      return NextResponse.json(
        {
          error: 'INVALID_TRANSITION',
          current: card.status,
          requested: requestedStatus,
          expected: expectedNext ?? null,
          message: expectedNext
            ? `Can only advance from ${card.status} to ${expectedNext}`
            : `${card.status} is a terminal trust state`,
        },
        { status: 409 },
      );
    }

    // 5. Update status
    await prisma.platformContextSemantic.update({
      where: { id: semanticCardId },
      data: { status: requestedStatus },
    });

    // 6. Audit trail — write to platform_sem_audit via writeAuditRow if a T4 model exists.
    // platform_sem_audit.model_id has a FK constraint to platform_semantic_models.id —
    // we can only write if a semantic model row exists for this object. This is documented
    // in PHASE_DS3A_DECISIONS.md as an audit trail constraint.
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { org_id: orgId, full_path: object.full_path },
      select: { model_id: true },
      orderBy: { created_at: 'desc' },
    });

    if (entity?.model_id) {
      await writeAuditRow({
        orgId,
        modelId: entity.model_id,
        tableName: 'platform_context_semantics',
        rowId: semanticCardId,
        action: 'promote',
        fromStatus: card.status,
        toStatus: requestedStatus,
        changedBy: session.user?.email ?? session.user?.name ?? 'unknown',
      });
    } else {
      // No T4 model yet — log the governance action server-side for traceability
      console.info(
        `[confirm-semantic] Audit row skipped — no platform_sem_entities row for ${object.full_path}. ` +
        `Status updated: ${card.status} → ${requestedStatus} by ${session.user?.email ?? 'unknown'}`,
      );
    }

    return NextResponse.json(
      { updated: true, newStatus: requestedStatus, version: card.version },
      { status: 200 },
    );
  } catch (err) {
    console.error('[context/objects/:id/confirm-semantic POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
