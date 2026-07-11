import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { validateEditFields, writeAuditRow, ALLOWED_EDIT_FIELDS } from '@/lib/semantic/governance';
import type { TableKind } from '@/lib/semantic/governance';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/inspector/semantic/[modelId]/definitions/[definitionId]
 *
 * Edits a definition (entity / dimension / measure) in-place.
 * Body: { tableKind: 'entity' | 'dimension' | 'measure', fields: Record<string, unknown> }
 *
 * Lookup: queries the single table identified by tableKind WHERE id = definitionId.
 * Does NOT search across tables. 404 if not found.
 * Org is verified via the entity's org_id (for entities) or the parent entity (for dims/measures).
 * Rejects disallowed fields with 400.
 * Writes an audit row (action='edit', diff=[...]) for each changed field.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string; definitionId: string }> },
) {
  try {
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

    // ── Verify org scope + load current row ───────────────────────────────────

    if (tableKind === 'entity') {
      const existing = await prisma.platform_sem_entities.findFirst({
        where: { id: definitionId, model_id: modelId, org_id: org.id },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
      }

      const diff = Object.keys(fields).map((f) => ({
        field: f,
        old: (existing as Record<string, unknown>)[f] ?? null,
        new: fields[f],
      }));

      const updated = await prisma.platform_sem_entities.update({
        where: { id: definitionId },
        data: { ...(fields as Parameters<typeof prisma.platform_sem_entities.update>[0]['data']), updated_at: new Date() },
      });

      await writeAuditRow({
        orgId: org.id,
        modelId,
        tableName: 'platform_sem_entities',
        rowId: definitionId,
        action: 'edit',
        diff,
      });

      return NextResponse.json({ updated: true, definition: updated });
    }

    if (tableKind === 'dimension') {
      const existing = await prisma.platform_sem_dimensions.findFirst({
        where: { id: definitionId, org_id: org.id },
        include: { platform_sem_entities: { select: { model_id: true } } },
      });
      if (!existing || existing.platform_sem_entities.model_id !== modelId) {
        return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
      }

      const diff = Object.keys(fields).map((f) => ({
        field: f,
        old: (existing as Record<string, unknown>)[f] ?? null,
        new: fields[f],
      }));

      const updated = await prisma.platform_sem_dimensions.update({
        where: { id: definitionId },
        data: { ...(fields as Parameters<typeof prisma.platform_sem_dimensions.update>[0]['data']), updated_at: new Date() },
      });

      await writeAuditRow({
        orgId: org.id,
        modelId,
        tableName: 'platform_sem_dimensions',
        rowId: definitionId,
        action: 'edit',
        diff,
      });

      return NextResponse.json({ updated: true, definition: updated });
    }

    // tableKind === 'measure'
    // Use $queryRaw to load (partial unique index on column_name — $executeRaw for writes)
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT m.*, e.model_id
      FROM platform_sem_measures m
      JOIN platform_sem_entities e ON e.id = m.entity_id
      WHERE m.id = ${definitionId}
        AND m.org_id = ${org.id}
      LIMIT 1
    `;
    if (!rows.length || rows[0].model_id !== modelId) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }
    const existingMeasure = rows[0];

    const diff = Object.keys(fields).map((f) => ({
      field: f,
      old: existingMeasure[f] ?? null,
      new: fields[f],
    }));

    // Build SET clause — only allowed fields, typed manually for $executeRaw safety
    const allowedKeys = Array.from(ALLOWED_EDIT_FIELDS.measure);
    const safeFields: Record<string, unknown> = {};
    for (const k of allowedKeys) {
      if (k in fields) safeFields[k] = fields[k];
    }

    // Execute update via $executeRaw to avoid triggering the partial-index constraint path.
    // Each allowed scalar field is handled explicitly — no dynamic column interpolation.
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
    if ('synonyms' in safeFields && Array.isArray(safeFields.synonyms))
      await prisma.$executeRaw`UPDATE platform_sem_measures SET synonyms = ${safeFields.synonyms}::text[], updated_at = now() WHERE id = ${definitionId}`;

    // Read back updated row
    const updatedRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM platform_sem_measures WHERE id = ${definitionId} LIMIT 1
    `;

    await writeAuditRow({
      orgId: org.id,
      modelId,
      tableName: 'platform_sem_measures',
      rowId: definitionId,
      action: 'edit',
      diff,
    });

    return NextResponse.json({ updated: true, definition: updatedRows[0] ?? null });
  } catch (err) {
    console.error('[semantic/definitions PATCH]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
