import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardInspectorChat } from '@/lib/inspector/session-auth';
import { loadConstructionState } from '@/lib/construction/load-state';
import { applyUserEdit, isEditableField, parseEditValue } from '@/lib/construction/user-edits';
import { persistCommissionedAgent } from '@/lib/construction/persist-commissioned';
import { getDefaultOrg } from '@/lib/platform/agents';

export const dynamic = 'force-dynamic';

/**
 * Field-level edit from the workbench Config panel. Records provenance `user`, so
 * the builder model treats the field as user-owned from then on.
 */
export async function PATCH(request: NextRequest) {
  /** `confirm` marks a matching assumption as confirmed instead of corrected. */
  let body: { sessionId?: string; field?: string; value?: unknown; confirm?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  if (!body.sessionId || !body.field) {
    return NextResponse.json({ error: 'sessionId and field required' }, { status: 400 });
  }
  if (!isEditableField(body.field)) {
    return NextResponse.json({ error: `Field "${body.field}" is not editable` }, { status: 400 });
  }
  const parsedValue = parseEditValue(body.field, body.value);
  if (!parsedValue.ok) {
    return NextResponse.json({ error: parsedValue.error }, { status: 400 });
  }

  const row = await prisma.workbench_sessions.findUnique({
    where: { id: body.sessionId },
    select: { construction_state: true, saved_agent_id: true },
  });
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const org = await getDefaultOrg();
  const state = loadConstructionState(row.construction_state, org.id);

  const next = applyUserEdit(state, body.field, parsedValue.value, body.confirm ? 'confirmed' : 'corrected');
  await prisma.workbench_sessions.update({
    where: { id: body.sessionId },
    data: {
      construction_state: next as unknown as object,
      readiness: next.readiness,
      updated_at: new Date(),
    },
  });

  // A commissioned agent stays editable. The catalog copy is what Use and View read later.
  if (row.saved_agent_id) {
    try {
      await persistCommissionedAgent(row.saved_agent_id, next);
    } catch (err) {
      console.error('[construction] catalog sync failed', err);
      return NextResponse.json({
        state: next,
        warning: 'Saved on this draft, but the catalog copy could not be updated. Try the edit again.',
      });
    }
  }

  return NextResponse.json({ state: next });
}
