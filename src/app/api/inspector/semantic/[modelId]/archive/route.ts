import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { archiveEntities, archiveDefinitions } from '@/lib/semantic/governance';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/archive
 *
 * Archives entities or individual definitions (status = 'archived').
 *
 * Entity path:
 *   Body: { entityIds: string[] }
 *   - Writes audit rows (action='demote_archive') for each entity
 *   - Recalculates model status after archiving
 *   - Archived entities and their dims/measures/joins are excluded from agent queries
 *   - Returns { archived: string[], errors: { id, reason }[] }
 *
 * Definition path:
 *   Body: { definitionIds: string[], tableKind: 'dimension' | 'measure' }
 *   - tableKind is REQUIRED and must be exactly 'dimension' or 'measure'
 *   - No parent-entity constraint — archiving is always valid regardless of entity status
 *   - Already-archived definitions are a no-op success
 *   - Writes audit rows (action='demote_archive') for each definition
 *   - Does NOT recalculate model status
 *   - Returns { archived: string[], errors: { id, reason }[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const org = await getDefaultOrg();
    const { modelId } = await params;

    const body = await request.json() as {
      entityIds?: unknown;
      definitionIds?: unknown;
      tableKind?: unknown;
    };

    const hasEntityPath = Array.isArray(body.entityIds) && (body.entityIds as unknown[]).length > 0;
    const hasDefPath = Array.isArray(body.definitionIds) && (body.definitionIds as unknown[]).length > 0;

    if (hasEntityPath && hasDefPath) {
      return NextResponse.json(
        { error: 'specify entityIds OR definitionIds, not both' },
        { status: 400 },
      );
    }
    if (!hasEntityPath && !hasDefPath) {
      return NextResponse.json(
        { error: 'must provide entityIds or definitionIds' },
        { status: 400 },
      );
    }

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    if (hasDefPath) {
      const tableKind = body.tableKind;
      if (tableKind !== 'dimension' && tableKind !== 'measure') {
        return NextResponse.json(
          { error: "tableKind must be 'dimension' or 'measure' when definitionIds is provided" },
          { status: 400 },
        );
      }
      const result = await archiveDefinitions(
        body.definitionIds as string[],
        tableKind,
        modelId,
        org.id,
      );
      return NextResponse.json({ archived: result.succeeded, errors: result.errors });
    }

    const result = await archiveEntities(body.entityIds as string[], modelId, org.id);
    return NextResponse.json({ archived: result.succeeded, errors: result.errors });
  } catch (err) {
    console.error('[semantic/archive POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
