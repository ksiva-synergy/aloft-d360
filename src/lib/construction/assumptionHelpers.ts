import type { ConstructionState } from './constructionState';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AssumptionLedgerEntry = ConstructionState['assumptionLedger'][number];

type AppendInput = Omit<AssumptionLedgerEntry, 'status'> & { status?: 'assumed' };

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Append an entry to assumptionLedger[]. Deduplicates by field — if an entry
 * with the same field already exists it is replaced (not appended twice).
 * status defaults to 'assumed'.
 *
 * Returns a new ConstructionState (immutable — original state is not mutated).
 */
export function appendAssumption(
  state: ConstructionState,
  entry: AppendInput,
): ConstructionState {
  const normalized: AssumptionLedgerEntry = {
    ...entry,
    status: entry.status ?? 'assumed',
  };

  const existingIdx = state.assumptionLedger.findIndex((e) => e.field === entry.field);
  const nextLedger =
    existingIdx === -1
      ? [...state.assumptionLedger, normalized]
      : state.assumptionLedger.map((e, i) => (i === existingIdx ? normalized : e));

  return { ...state, assumptionLedger: nextLedger };
}

/**
 * Set an existing ledger entry's status to 'confirmed' and record provenance
 * as 'user'. No-op if the field is not found in the ledger.
 *
 * Returns a new ConstructionState (immutable).
 */
export function confirmAssumption(
  state: ConstructionState,
  field: string,
): ConstructionState {
  const idx = state.assumptionLedger.findIndex((e) => e.field === field);
  if (idx === -1) return state;

  const nextLedger = state.assumptionLedger.map((e, i) =>
    i === idx ? { ...e, status: 'confirmed' as const } : e,
  );

  return {
    ...state,
    assumptionLedger: nextLedger,
    provenance: { ...state.provenance, [field]: 'user' as const },
  };
}

/**
 * Set an existing ledger entry's value, status to 'corrected', and record
 * provenance as 'user'. No-op if the field is not found in the ledger.
 *
 * Returns a new ConstructionState (immutable).
 */
export function correctAssumption(
  state: ConstructionState,
  field: string,
  newValue: unknown,
): ConstructionState {
  const idx = state.assumptionLedger.findIndex((e) => e.field === field);
  if (idx === -1) return state;

  const nextLedger = state.assumptionLedger.map((e, i) =>
    i === idx ? { ...e, value: newValue, status: 'corrected' as const } : e,
  );

  return {
    ...state,
    assumptionLedger: nextLedger,
    provenance: { ...state.provenance, [field]: 'user' as const },
  };
}
