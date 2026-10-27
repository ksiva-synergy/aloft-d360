import { z } from 'zod';
import type { ConstructionState } from './constructionState';
import { setConstructionField } from './apply-patch';
import { coerceConstructionState } from './load-state';
import { deriveReadiness } from './readiness';

/**
 * Fields the user can edit directly in the Config panel. Anything else is
 * builder-internal (readiness, ledger, memory provisioning) and stays server-owned.
 */
const datasourceSchema = z.object({
  kind: z.enum(['kb', 'databricks', 'mcp', 'api']),
  ref: z.string().trim().min(1).max(300),
  scope: z.string().trim().max(300).nullable().default(null),
});

const actionSchema = z.object({
  toolId: z.string().trim().min(1).max(200),
  tier: z.enum(['local', 'mcp', 'governed', 'skill']),
});

const optionalText = (max: number) =>
  z.string().max(max).nullable().transform((v) => (v?.trim() ? v.trim() : null));

export const EDITABLE_FIELDS = {
  name: optionalText(120),
  'class.id': z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{1,40}$/, 'Class id must be a short lowercase slug'),
  'prompt.instructions': z.string().max(20000).transform((v) => v.trim()),
  'prompt.persona': optionalText(500),
  'tools.datasources': z
    .array(datasourceSchema)
    .max(50)
    .transform((list) => list.filter((d, i) => list.findIndex((x) => x.kind === d.kind && x.ref === d.ref) === i)),
  'tools.actions': z
    .array(actionSchema)
    .max(50)
    .transform((list) => list.filter((a, i) => list.findIndex((x) => x.toolId === a.toolId) === i)),
} as const;

export type EditableField = keyof typeof EDITABLE_FIELDS;

export function isEditableField(field: string): field is EditableField {
  return Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, field);
}

export function parseEditValue(
  field: EditableField,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const parsed = EDITABLE_FIELDS[field].safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid value' };
}

export function getConstructionField(state: ConstructionState, field: string): unknown {
  let cursor: unknown = state;
  for (const key of field.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * The user-owned provenance key that covers `field`, if any. Covers parents and
 * children both ways: a user edit to `class.id` locks an AI write to `class`, and
 * a user edit to `prompt` would lock `prompt.instructions`.
 */
export function userLockFor(state: ConstructionState, field: string): string | null {
  for (const [key, source] of Object.entries(state.provenance)) {
    // Only panel-editable fields lock; a confirmed free-form assumption key does not.
    if (source !== 'user' || !isEditableField(key)) continue;
    if (key === field || field.startsWith(`${key}.`) || key.startsWith(`${field}.`)) return key;
  }
  return null;
}

/** Apply a validated user edit: value, provenance, ledger status and readiness. */
export function applyUserEdit(
  state: ConstructionState,
  field: EditableField,
  value: unknown,
  ledgerStatus: 'corrected' | 'confirmed' = 'corrected',
): ConstructionState {
  let next = setConstructionField(state, field, value, 'user');
  if (field === 'class.id') {
    next = { ...next, class: { id: value as string, source: 'chosen', confidence: 1, skillRef: next.class?.skillRef ?? null } };
  }
  next = {
    ...next,
    assumptionLedger: next.assumptionLedger.map((e) =>
      e.field === field ? { ...e, value, status: ledgerStatus } : e,
    ),
  };
  next = coerceConstructionState(next);
  return { ...next, readiness: next.readiness === 'commission' ? 'commission' : deriveReadiness(next) };
}

/**
 * End-of-turn merge for the workbench chat route. The route loads state at the
 * start of a turn and writes it back at the end; without this, an edit the user
 * made in the Config panel while the model was streaming would be overwritten.
 * User-owned fields in the DB win unless the turn itself wrote them as `user`
 * (the model relaying an explicit request from the chat).
 */
export function mergeUserEdits(turnState: ConstructionState, dbState: ConstructionState): ConstructionState {
  let next = turnState;
  for (const [key, source] of Object.entries(dbState.provenance)) {
    if (source !== 'user' || turnState.provenance[key] === 'user') continue;
    const dbValue = getConstructionField(dbState, key);
    if (dbValue === undefined) continue;
    next = setConstructionField(next, key, dbValue, 'user');
  }
  const settled = new Map(
    dbState.assumptionLedger.filter((e) => e.status !== 'assumed').map((e) => [e.field, e]),
  );
  next = {
    ...next,
    assumptionLedger: next.assumptionLedger.map((e) => settled.get(e.field) ?? e),
    // Test runs and commission are written by their own routes, never by a chat turn.
    validation: dbState.validation,
    memory: dbState.readiness === 'commission' ? dbState.memory : next.memory,
  };
  next = coerceConstructionState(next);
  const commissioned = dbState.readiness === 'commission' || next.readiness === 'commission';
  return { ...next, readiness: commissioned ? 'commission' : deriveReadiness(next) };
}
