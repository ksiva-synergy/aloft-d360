import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { promoteEntities, promoteDefinitions } from '@/lib/semantic/governance';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inspector/semantic/[modelId]/promote
 *
 * Promotes entities or individual definitions to 'governed' status.
 *
 * Entity path:
 *   Body: { entityIds: string[] }
 *   - Promotion is always at entity level (dims/measures/joins inherit)
 *   - Archived entities cannot be promoted
 *   - Writes audit rows (action='promote') for each entity
 *   - Recalculates model status: 'governed' if any entity is governed
 *   - Returns { promoted: string[], errors: { id, reason }[] }
 *
 * Definition path:
 *   Body: { definitionIds: string[], tableKind: 'dimension' | 'measure' }
 *   - tableKind is REQUIRED and must be exactly 'dimension' or 'measure'
 *   - Parent entity must already be governed (guard enforced in promoteDefinitions)
 *   - Archived definitions cannot be promoted
 *   - Writes audit rows (action='promote') for each definition
 *   - Does NOT recalculate model status
 *   - Returns { promoted: string[], errors: { id, reason }[] }
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
      const result = await promoteDefinitions(
        body.definitionIds as string[],
        tableKind,
        modelId,
        org.id,
      );
      return NextResponse.json({ promoted: result.succeeded, errors: result.errors });
    }

    const result = await promoteEntities(body.entityIds as string[], modelId, org.id);
    return NextResponse.json({ promoted: result.succeeded, errors: result.errors });
  } catch (err) {
    console.error('[semantic/promote POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
