import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import { validateEditFields, writeAuditRow, ALLOWED_EDIT_FIELDS, recalculateModelStatus } from '@/lib/semantic/governance';
import type { TableKind } from '@/lib/semantic/governance';
import { isAdmin, evaluatePromotionEligibility } from '@/lib/semantic/promotion-gate';
import { decideEditGate, touchesComputation } from '@/lib/semantic/authoring-draft';
import { compileSafety } from '@/lib/semantic/compiler';
import { upsertIntentEmbedding } from '@/lib/semantic/intent-embed';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/inspector/semantic/[modelId]/definitions/[definitionId]
 *
 * Edits a definition (entity / dimension / measure) in-place.
 * Body: { tableKind: 'entity' | 'dimension' | 'measure', fields: Record<string, unknown> }
 *
 * GATING (Phase 3.5B — deliverable 6; this route was previously ungated):
 *   - Editing your OWN draft (created_by === caller && status === 'draft') → free.
 *     It is not trusted yet; nothing depends on it.
 *   - Editing a candidate → reputation-gated: admin OR self-approve eligibility
 *     (same bar as promoting it).
 *   - Editing a governed definition → reputation-gated AND the definition is
 *     forced back to 'candidate' for re-review. A governed metric's numbers are
 *     baked into saved dashboards via measureSnapshots; silently editing its
 *     aggregate/expression while keeping it governed would change everyone's
 *     numbers with no re-validation. Demotion makes the changed definition
 *     re-earn governance through the reputation-gated ladder. Both the edit and
 *     the demotion get an audit row.
 *
 * Field allowlist (ALLOWED_EDIT_FIELDS) and compileSafety on any edited
 * expression are enforced regardless of who is editing.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string; definitionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? null;
    const currentUser = userEmail ? await getUserByEmail(userEmail) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const org = await getDefaultOrg();
    const { modelId, definitionId } = await params;

    const body = await request.json() as { tableKind?: unknown; fields?: unknown };
    const tableKind = body.tableKind as TableKind | undefined;
    const fields = body.fields as Record<string, unknown> | undefined;

    if (!tableKind || !(['entity', 'dimension', 'measure'] as const).includes(tableKind as TableKind)) {
      return NextResponse.json({ error: 'tableKind must be entity, dimension, or measure' }, { status: 400 });
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return NextResponse.json({ error: 'fields must be an object' }, { status: 400 });
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'fields must not be empty' }, { status: 400 });
    }

    const validation = validateEditFields(tableKind as TableKind, fields);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Field '${validation.rejected}' is not editable on ${tableKind}s` },
        { status: 400 },
      );
    }

    // compileSafety on any edited expression (measures only) — reject DDL tokens.
    if ('expression' in fields && typeof fields.expression === 'string') {
      const safety = compileSafety(fields.expression);
      if (!safety.safe) {
        return NextResponse.json({ error: safety.reason ?? 'expression rejected' }, { status: 400 });
      }
    }

    // ── Load the current row (status + created_by) for the gate ───────────────
    const target = await loadDefinition(tableKind as TableKind, definitionId, modelId, org.id);
    if (!target) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }

    // ── Edit gate ─────────────────────────────────────────────────────────────
    const isOwnDraft = target.status === 'draft' && target.created_by === currentUser.id;
    let admin = false;
    let canSelfApprove = false;
    if (!isOwnDraft && target.status !== 'archived') {
      admin = await isAdmin(currentUser.id);
      if (!admin) {
        const eligibility = await evaluatePromotionEligibility(currentUser.id, org.id);
        canSelfApprove = eligibility.canSelfApprove;
      }
    }
    const gate = decideEditGate({
      status: target.status,
      isOwnDraft,
      isAdmin: admin,
      canSelfApprove,
      // Demote a governed def only when a snapshot-relevant (computation) field
      // changed. This set mirrors MeasureSnapshot so the demotion rule and the
      // dashboard drift detector can't diverge — a cosmetic edit stays governed.
      touchesComputation: touchesComputation(tableKind as TableKind, Object.keys(fields)),
    });
    if (!gate.allowed) {
      return NextResponse.json({ error: `not authorized to edit — ${gate.reason}` }, { status: 403 });
    }

    // ── Apply the edit ────────────────────────────────────────────────────────
    const diff = target.buildDiff(fields);
    await target.applyEdit(fields);

    await writeAuditRow({
      orgId: org.id,
      modelId,
      tableName: target.tableName,
      rowId: definitionId,
      action: 'edit',
      changedBy: currentUser.id,
      diff,
    });

    // ── Sync NL-intent embedding (dimensions/measures only) ───────────────────
    // Re-embed when the intent text changed; clears the embedding if emptied.
    // Non-fatal. Status is resolved live at match time, so nothing to sync here
    // when only status changes (promote/demote handle that implicitly).
    if ('nl_intent' in fields && (tableKind === 'measure' || tableKind === 'dimension')) {
      await upsertIntentEmbedding({
        orgId: org.id,
        sourceType: tableKind,
        sourceId: definitionId,
        intentText: (fields.nl_intent as string | null | undefined) ?? null,
        modelId,
        createdBy: target.created_by,
      });
    }

    // ── Governed → candidate demotion on edit (deliverable 6) ─────────────────
    let demoted = false;
    if (gate.forceDemotion) {
      await target.setStatus('candidate');
      await writeAuditRow({
        orgId: org.id,
        modelId,
        tableName: target.tableName,
        rowId: definitionId,
        action: 'demote',
        fromStatus: 'governed',
        toStatus: 'candidate',
        changedBy: currentUser.id,
      });
      // Model status is entity-driven: demoting a governed entity may flip the
      // model back to 'candidate'. Definition (dim/measure) demotions never
      // affect model status, so only recalc for entities.
      if (target.tableName === 'platform_sem_entities') {
        await recalculateModelStatus(modelId, org.id);
      }
      demoted = true;
    }

    const updated = await target.reload();
    return NextResponse.json({ updated: true, demoted, definition: updated });
  } catch (err) {
    console.error('[semantic/definitions PATCH]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── Definition access shim ───────────────────────────────────────────────────
// Unifies the three tables behind one small interface: current status/owner for
// the gate, a diff builder, the edit apply (allowlisted), a status setter for
// the demotion, and a reload. Measures still go through $executeRaw for writes
// (the partial-index path the original route documented).

interface DefinitionHandle {
  tableName: string;
  status: string;
  created_by: string | null;
  buildDiff: (fields: Record<string, unknown>) => { field: string; old: unknown; new: unknown }[];
  applyEdit: (fields: Record<string, unknown>) => Promise<void>;
  setStatus: (status: string) => Promise<void>;
  reload: () => Promise<unknown>;
}

async function loadDefinition(
  tableKind: TableKind,
  definitionId: string,
  modelId: string,
  orgId: string,
): Promise<DefinitionHandle | null> {
  if (tableKind === 'entity') {
    const existing = await prisma.platform_sem_entities.findFirst({
      where: { id: definitionId, model_id: modelId, org_id: orgId },
    });
    if (!existing) return null;
    return {
      tableName: 'platform_sem_entities',
      status: existing.status,
      created_by: existing.created_by,
      buildDiff: (fields) => diffOf(existing as Record<string, unknown>, fields),
      applyEdit: async (fields) => {
        await prisma.platform_sem_entities.update({
          where: { id: definitionId },
          data: { ...(fields as Parameters<typeof prisma.platform_sem_entities.update>[0]['data']), updated_at: new Date() },
        });
      },
      setStatus: async (status) => {
        await prisma.platform_sem_entities.updateMany({ where: { id: definitionId }, data: { status, updated_at: new Date() } });
      },
      reload: () => prisma.platform_sem_entities.findUnique({ where: { id: definitionId } }),
    };
  }

  if (tableKind === 'dimension') {
    const existing = await prisma.platform_sem_dimensions.findFirst({
      where: { id: definitionId, org_id: orgId },
      include: { platform_sem_entities: { select: { model_id: true } } },
    });
    if (!existing || existing.platform_sem_entities.model_id !== modelId) return null;
    return {
      tableName: 'platform_sem_dimensions',
      status: existing.status,
      created_by: existing.created_by,
      buildDiff: (fields) => diffOf(existing as Record<string, unknown>, fields),
      applyEdit: async (fields) => {
        await prisma.platform_sem_dimensions.update({
          where: { id: definitionId },
          data: { ...(fields as Parameters<typeof prisma.platform_sem_dimensions.update>[0]['data']), updated_at: new Date() },
        });
      },
      setStatus: async (status) => {
        await prisma.platform_sem_dimensions.updateMany({ where: { id: definitionId }, data: { status, updated_at: new Date() } });
      },
      reload: () => prisma.platform_sem_dimensions.findUnique({ where: { id: definitionId } }),
    };
  }

  // measure — load via $queryRaw + join for model scope (partial unique index)
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT m.*, e.model_id
    FROM platform_sem_measures m
    JOIN platform_sem_entities e ON e.id = m.entity_id
    WHERE m.id = ${definitionId}
      AND m.org_id = ${orgId}
    LIMIT 1
  `;
  if (!rows.length || rows[0].model_id !== modelId) return null;
  const existingMeasure = rows[0];
  return {
    tableName: 'platform_sem_measures',
    status: String(existingMeasure.status),
    created_by: (existingMeasure.created_by as string | null) ?? null,
    buildDiff: (fields) => diffOf(existingMeasure, fields),
    applyEdit: async (fields) => {
      const allowedKeys = Array.from(ALLOWED_EDIT_FIELDS.measure);
      const safeFields: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in fields) safeFields[k] = fields[k];
      }
      // Each allowed scalar handled explicitly — no dynamic column interpolation.
      if ('measure_label' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET measure_label = ${safeFields.measure_label as string}, updated_at = now() WHERE id = ${definitionId}`;
      if ('aggregate' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET aggregate = ${safeFields.aggregate as string}, updated_at = now() WHERE id = ${definitionId}`;
      if ('metric_type' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET metric_type = ${safeFields.metric_type as string}, updated_at = now() WHERE id = ${definitionId}`;
      if ('expression' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET expression = ${safeFields.expression as string | null}, updated_at = now() WHERE id = ${definitionId}`;
      if ('format_hint' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET format_hint = ${safeFields.format_hint as string | null}, updated_at = now() WHERE id = ${definitionId}`;
      if ('unit' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET unit = ${safeFields.unit as string | null}, updated_at = now() WHERE id = ${definitionId}`;
      if ('nl_intent' in safeFields)
        await prisma.$executeRaw`UPDATE platform_sem_measures SET nl_intent = ${safeFields.nl_intent as string | null}, updated_at = now() WHERE id = ${definitionId}`;
      if ('synonyms' in safeFields && Array.isArray(safeFields.synonyms))
        await prisma.$executeRaw`UPDATE platform_sem_measures SET synonyms = ${safeFields.synonyms}::text[], updated_at = now() WHERE id = ${definitionId}`;
    },
    setStatus: async (status) => {
      await prisma.$executeRaw`UPDATE platform_sem_measures SET status = ${status}, updated_at = now() WHERE id = ${definitionId}`;
    },
    reload: async () => {
      const updatedRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM platform_sem_measures WHERE id = ${definitionId} LIMIT 1
      `;
      return updatedRows[0] ?? null;
    },
  };
}

function diffOf(existing: Record<string, unknown>, fields: Record<string, unknown>) {
  return Object.keys(fields).map((f) => ({
    field: f,
    old: existing[f] ?? null,
    new: fields[f],
  }));
}
