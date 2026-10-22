import { constructionStateSchema, type ConstructionState } from './constructionState';

/** Client-side placeholder until session construction_state is hydrated from the API. */
export function emptyConstructionDraft(orgId = 'pending'): ConstructionState {
  return constructionStateSchema.parse({
    memory: { buildContext: { orgId } },
  });
}
