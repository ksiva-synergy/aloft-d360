import type { ConstructionState } from './constructionState';

/** Derive builder readiness from populated construction fields. */
export function deriveReadiness(state: ConstructionState): ConstructionState['readiness'] {
  const name = state.name?.trim();
  const instructions = state.prompt?.instructions?.trim() ?? '';
  const classId = state.class?.id;

  if (name && instructions.length >= 40 && classId) {
    return 'validate';
  }
  if (name && instructions.length >= 20) {
    return 'build';
  }
  if (instructions.length > 0 || name) {
    return 'plan';
  }
  return 'interview';
}

export function canCommissionAgent(state: ConstructionState): boolean {
  const readiness = deriveReadiness(state);
  return readiness === 'validate' || readiness === 'commission';
}
