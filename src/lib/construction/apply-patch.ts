import type { ConstructionState } from './constructionState';
import { appendAssumption } from './assumptionHelpers';

/** Apply a dot-path field update to construction state (immutable). */
export function setConstructionField(
  state: ConstructionState,
  field: string,
  value: unknown,
  source: 'ai' | 'user' | 'template' = 'ai',
): ConstructionState {
  const next: ConstructionState = JSON.parse(JSON.stringify(state)) as ConstructionState;
  const parts = field.split('.');
  let cursor: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cursor[key] === null || cursor[key] === undefined || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  next.provenance = { ...next.provenance, [field]: source };
  return next;
}

export function applyConstructionPatch(
  state: ConstructionState,
  field: string,
  value: unknown,
  source: 'ai' | 'user' | 'template',
): ConstructionState {
  return setConstructionField(state, field, value, source);
}

export function applyAssumption(
  state: ConstructionState,
  entry: { field: string; value: unknown; confidence: number; rationale: string },
): ConstructionState {
  return appendAssumption(state, entry);
}
