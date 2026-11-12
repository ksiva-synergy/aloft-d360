/** How many other models to try after the one the user asked for. */
export const MODEL_FALLBACK_LIMIT = 5;

/**
 * Order of models to try after `primaryId` fails.
 * The configured default comes first, then the other chat models the gateway currently allows.
 * When the catalog could not be loaded, only the configured default is offered.
 */
export function orderFallbackModelIds(primaryId: string, availableIds: string[], preferredId?: string): string[] {
  const available = new Set(availableIds);
  const out: string[] = [];
  const push = (id?: string) => {
    if (!id || id === primaryId || out.includes(id)) return;
    out.push(id);
  };
  if (preferredId && (available.size === 0 || available.has(preferredId))) push(preferredId);
  for (const id of availableIds) push(id);
  return out;
}

/** The model never produced text or a tool call, so another model can still answer this turn. */
export function modelFailureCanFallback(result: {
  outcome: string;
  finalText?: string | null;
  toolCalls?: unknown[];
  errorDetail?: string;
}): boolean {
  if (result.outcome !== 'errored') return false;
  if ((result.toolCalls?.length ?? 0) > 0) return false;
  if ((result.finalText ?? '').trim()) return false;
  return true;
}

/** A hung model. Two of these in a row stop the chain so a turn cannot wait on every model. */
export function isSlowModelFailure(detail?: string): boolean {
  if (!detail) return false;
  return /timed out|timeout|ETIMEDOUT/i.test(detail);
}

/** Gateway/model errors worth trying the next model for. A bad API key is not one of them. */
export function isRetryableModelHttpFailure(status: number, body: string): boolean {
  if (status === 404 || status === 408 || status === 409 || status === 429) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status === 400 || status === 403 || status === 422) return /model/i.test(body);
  return false;
}
