import { z } from 'zod';
import {
  constructionStateSchema,
  type ConstructionState,
} from './constructionState';

const toolActionSchema = z.object({
  toolId: z.string(),
  tier: z.enum(['local', 'mcp', 'governed', 'skill']),
});

/** Drop malformed tool actions (LLM patches often omit toolId/tier). */
function sanitizeRawConstructionState(raw: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const tools = clone.tools;
  if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
    const t = tools as Record<string, unknown>;
    if (Array.isArray(t.actions)) {
      t.actions = t.actions.filter((entry) => toolActionSchema.safeParse(entry).success);
    }
  }
  return clone;
}

/** True when raw JSON fails schema but sanitization (e.g. bad tool actions) fixes it. */
export function constructionStateNeedsRepair(raw: unknown): boolean {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  if (constructionStateSchema.safeParse(raw).success) return false;
  const sanitized = sanitizeRawConstructionState(raw as Record<string, unknown>);
  return constructionStateSchema.safeParse(sanitized).success;
}

/** Parse DB/client construction JSON without throwing; repair or reset on corruption. */
export function loadConstructionState(
  raw: unknown,
  orgId: string,
): ConstructionState {
  const empty = constructionStateSchema.parse({
    memory: { buildContext: { orgId } },
  });

  if (raw === null || raw === undefined) return empty;

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return empty;
  }

  const sanitized = sanitizeRawConstructionState(raw as Record<string, unknown>);
  const parsed = constructionStateSchema.safeParse(sanitized);
  if (parsed.success) return parsed.data;

  console.warn(
    '[construction] state failed validation after sanitize; resetting to empty draft',
    parsed.error.flatten(),
  );
  return empty;
}

/** Re-validate after in-memory patches (agent tools). */
export function coerceConstructionState(state: ConstructionState): ConstructionState {
  const sanitized = sanitizeRawConstructionState(
    state as unknown as Record<string, unknown>,
  );
  const parsed = constructionStateSchema.safeParse(sanitized);
  return parsed.success ? parsed.data : state;
}
