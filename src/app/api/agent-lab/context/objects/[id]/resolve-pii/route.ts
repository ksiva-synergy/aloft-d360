import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { writeAuditRow } from '@/lib/semantic/governance';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/agent-lab/context/objects/[id]/resolve-pii
 *
 * Records a PII resolution decision for specific columns on a semantic card.
 * Version-scoped: mirrors confirm-semantic's semanticId + version guard pattern.
 *
 * Body: {
 *   semanticId: string,    — the specific semantic card row id
 *   version: number,       — the version the reviewer saw (staleness check)
 *   resolution: 'acknowledged' | 'false_positive',
 *   columns: string[]      — REQUIRED, which flagged columns this action covers
 * }
 *
 * Storage: audit rows only (platform_sem_audit). Does NOT mutate the semantic
 * card's pii_columns array — LLM-generated data stays immutable. Resolution
 * state is derived by querying audit history for the semanticId/version.
 *
 * 409 VERSION_SUPERSEDED if given version < current latest for this object.
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
  const { semanticId, version, resolution, columns } = body;

  if (!semanticId) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'semanticId', message: 'semanticId is required' },
      { status: 400 },
    );
  }
  if (version === undefined || version === null || typeof version !== 'number') {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'version', message: 'version (number) is required' },
      { status: 400 },
    );
  }
  if (!resolution || !['acknowledged', 'false_positive'].includes(resolution)) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'resolution', message: 'resolution must be acknowledged or false_positive' },
      { status: 400 },
    );
  }
  if (!columns || !Array.isArray(columns) || columns.length === 0) {
    return NextResponse.json(
      { error: 'BAD_REQUEST', field: 'columns', message: 'columns (non-empty array) is required' },
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

    // 2. Fetch the specific semantic card by ID
    const card = await prisma.platformContextSemantic.findFirst({
      where: { id: semanticId, subject_id: objectId, subject_kind: 'object', org_id: orgId },
    });
    if (!card) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Semantic card not found for this object' },
        { status: 404 },
      );
    }

    // 3. Validate requested version matches card
    if (card.version !== version) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: 'semanticId and version do not match' },
        { status: 400 },
      );
    }

    // 4. Version guard — check if a newer version now exists (same as confirm-semantic)
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
          message: 'A newer version of this card exists — refresh the page to review the latest version before resolving PII',
          latestVersion: newerCard.version,
        },
        { status: 409 },
      );
    }

    // 5. Write audit row — record the PII resolution decision per-column
    // Uses the same writeAuditRow helper as confirm-semantic, with action 'pii_review'.
    // If no T4 model entity exists, we find an alternative model_id or use a sentinel.
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { org_id: orgId, full_path: object.full_path },
      select: { model_id: true },
      orderBy: { created_at: 'desc' },
    });

    const modelId = entity?.model_id ?? 'pii_review_unlinked';

    await writeAuditRow({
      orgId,
      modelId,
      tableName: 'platform_context_semantics',
      rowId: semanticId,
      action: 'edit' as any,
      fromStatus: null,
      toStatus: resolution,
      changedBy: session.user?.email ?? session.user?.name ?? 'unknown',
      diff: [{ field: 'pii_review', old: null, new: { resolution, columns, version } }],
    });

    return NextResponse.json(
      {
        resolved: true,
        resolution,
        columns,
        version: card.version,
        semanticId,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[context/objects/:id/resolve-pii POST]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
