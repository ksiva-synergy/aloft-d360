import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createId } from '@paralleldrive/cuid2';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import {
  validateDraftMeasure,
  validateDraftDimension,
  type DraftMeasureInput,
  type DraftDimensionInput,
} from '@/lib/semantic/authoring-draft';
import { upsertIntentEmbedding } from '@/lib/semantic/intent-embed';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * /api/inspector/semantic/[modelId]/drafts  (Phase 3.5B)
 *
 * GET  — the current user's OWN draft definitions (measures + dimensions),
 *        grouped by entity. Owner-scoped by construction: created_by === caller
 *        AND status = 'draft'. Never surfaces another user's drafts, and never
 *        surfaces candidate/governed rows (those belong to the review panel).
 *
 * POST — create a new personal draft definition (the "Define a Metric" save).
 *        status: 'draft', created_by: <caller>. No reputation gate — authoring
 *        your own draft is free. Returns the created row so the UI can preview
 *        it immediately.
 *
 * Body (POST): { tableKind: 'measure' | 'dimension', fields: {...} }
 */

// ── GET: list the caller's drafts, grouped by entity ────────────────────────
export async function GET(
  _request: NextRequest,
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

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    // Entities in the model (all statuses) — needed for grouping labels.
    const entities = await prisma.platform_sem_entities.findMany({
      where: { model_id: modelId, org_id: org.id },
      orderBy: { created_at: 'asc' },
    });
    const entityIds = entities.map((e) => e.id);
    const entityById = new Map(entities.map((e) => [e.id, e]));

    // OWNER-SCOPED: only the caller's own drafts. This is the single guard that
    // keeps the surface private — created_by === caller AND status = 'draft'.
    const [dimensions, measures] = await Promise.all([
      prisma.platform_sem_dimensions.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: 'draft', created_by: currentUser.id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.platform_sem_measures.findMany({
        where: { entity_id: { in: entityIds }, org_id: org.id, status: 'draft', created_by: currentUser.id },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    // Group by entity, only emitting entities that actually own a draft.
    const groups = new Map<
      string,
      {
        entityId: string;
        entityLabel: string;
        dimensions: typeof dimensions;
        measures: typeof measures;
      }
    >();
    const ensure = (entityId: string) => {
      let g = groups.get(entityId);
      if (!g) {
        const e = entityById.get(entityId);
        g = {
          entityId,
          entityLabel: e?.entity_label ?? entityId,
          dimensions: [],
          measures: [],
        };
        groups.set(entityId, g);
      }
      return g;
    };
    for (const d of dimensions) ensure(d.entity_id).dimensions.push(d);
    for (const m of measures) ensure(m.entity_id).measures.push(m);

    const entitiesOut = [...groups.values()].map((g) => ({
      // Carry the model identity per group so a shared MyDraftsSection can route
      // mutations without knowing whether it's model- or org-scoped (W1).
      modelId: model.id,
      modelName: model.name,
      entityId: g.entityId,
      entityLabel: g.entityLabel,
      dimensions: g.dimensions.map((d) => ({
        id: d.id,
        column_name: d.column_name,
        dimension_label: d.dimension_label,
        dimension_type: d.dimension_type,
        format_hint: d.format_hint,
        nl_intent: d.nl_intent,
        status: d.status,
      })),
      measures: g.measures.map((m) => ({
        id: m.id,
        column_name: m.column_name,
        measure_label: m.measure_label,
        aggregate: m.aggregate,
        metric_type: m.metric_type,
        expression: m.expression,
        unit: m.unit,
        format_hint: m.format_hint,
        nl_intent: m.nl_intent,
        status: m.status,
      })),
    }));

    return NextResponse.json({
      model: { id: model.id, name: model.name, status: model.status },
      entities: entitiesOut,
    });
  } catch (err) {
    console.error('[semantic/drafts GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── POST: create a draft definition ──────────────────────────────────────────
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

    const body = (await request.json()) as { tableKind?: unknown; fields?: unknown };
    const tableKind = body.tableKind;
    if (tableKind !== 'measure' && tableKind !== 'dimension') {
      return NextResponse.json({ error: "tableKind must be 'measure' or 'dimension'" }, { status: 400 });
    }
    const fields = body.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return NextResponse.json({ error: 'fields must be an object' }, { status: 400 });
    }

    const model = await prisma.platform_semantic_models.findFirst({
      where: { id: modelId, org_id: org.id },
    });
    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    // The measure/dimension must attach to an entity the caller may author
    // against: an entity in this model that is NOT archived and NOT another
    // user's private draft. (Governed + candidate + own-draft entities qualify.)
    const entityId = String((fields as Record<string, unknown>).entity_id ?? '');
    if (!entityId) {
      return NextResponse.json({ error: 'entity_id is required' }, { status: 400 });
    }
    const entity = await prisma.platform_sem_entities.findFirst({
      where: { id: entityId, model_id: modelId, org_id: org.id },
      select: { id: true, status: true, created_by: true },
    });
    if (!entity) {
      return NextResponse.json({ error: 'entity not found in this model' }, { status: 404 });
    }
    if (entity.status === 'archived') {
      return NextResponse.json({ error: 'cannot author against an archived entity' }, { status: 400 });
    }
    if (entity.status === 'draft' && entity.created_by !== currentUser.id) {
      return NextResponse.json({ error: 'cannot author against another user\'s draft entity' }, { status: 403 });
    }

    if (tableKind === 'measure') {
      const input = fields as DraftMeasureInput;
      const validation = validateDraftMeasure(input);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.errors.join('; '), errors: validation.errors }, { status: 400 });
      }
      const id = createId();
      const isColumnMetric = input.metric_type === 'simple' || input.metric_type === 'cumulative';
      const created = await prisma.platform_sem_measures.create({
        data: {
          id,
          org_id: org.id,
          entity_id: entityId,
          measure_label: input.measure_label.trim(),
          metric_type: input.metric_type,
          aggregate: isColumnMetric ? (input.aggregate as string) : 'sum',
          column_name: isColumnMetric ? (input.column_name?.trim() || null) : null,
          expression: isColumnMetric ? null : (input.expression?.trim() || null),
          unit: input.unit?.trim() || null,
          format_hint: input.format_hint?.trim() || null,
          nl_intent: input.nl_intent?.trim() || null,
          status: 'draft',
          created_by: currentUser.id,
        },
      });
      // No audit row on draft creation — drafts are private and pre-governance;
      // the audit trail begins when the draft is submitted (draft → candidate).
      // Embed the NL intent (non-fatal) so it can power matching once governed.
      if (created.nl_intent) {
        await upsertIntentEmbedding({
          orgId: org.id,
          sourceType: 'measure',
          sourceId: id,
          intentText: created.nl_intent,
          modelId,
          createdBy: currentUser.id,
        });
      }
      return NextResponse.json({ created: true, tableKind, definition: created });
    }

    // tableKind === 'dimension'
    const input = fields as DraftDimensionInput;
    const validation = validateDraftDimension(input);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join('; '), errors: validation.errors }, { status: 400 });
    }
    const id = createId();
    try {
      const created = await prisma.platform_sem_dimensions.create({
        data: {
          id,
          org_id: org.id,
          entity_id: entityId,
          column_name: input.column_name.trim(),
          dimension_label: input.dimension_label.trim(),
          dimension_type: input.dimension_type || 'categorical',
          format_hint: input.format_hint?.trim() || null,
          nl_intent: input.nl_intent?.trim() || null,
          status: 'draft',
          created_by: currentUser.id,
        },
      });
      if (created.nl_intent) {
        await upsertIntentEmbedding({
          orgId: org.id,
          sourceType: 'dimension',
          sourceId: id,
          intentText: created.nl_intent,
          modelId,
          createdBy: currentUser.id,
        });
      }
      return NextResponse.json({ created: true, tableKind, definition: created });
    } catch (err) {
      // ux_psd_entity_col unique (entity_id, column_name) — surface cleanly.
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
        return NextResponse.json(
          { error: 'a dimension for this column already exists on this entity' },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    console.error('[semantic/drafts POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
