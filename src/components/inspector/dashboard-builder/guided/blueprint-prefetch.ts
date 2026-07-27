/**
 * src/components/inspector/dashboard-builder/guided/blueprint-prefetch.ts
 *
 * Guided Stage 2 — client-side blueprint PREFETCH cache.
 *
 * The blueprint proposal is a single ~20–30s LLM call. Without prefetch it only
 * starts when BlueprintStage mounts (i.e. after the user clicks "Use this
 * intent"), so the user watches a spinner for the whole call. This warms that
 * call the moment Stage 1 resolves, so it overlaps the user's confirm-model /
 * term-resolution / read-and-click think-time — turning ~25s of dead wait into
 * near-zero perceived latency in the common case.
 *
 * Freshness is exact, never stale: the warmed promise is keyed on the FULL
 * intent (topic + every disambiguation choice). If the user changes anything
 * after we warm, the key no longer matches and the consumer falls back to a
 * fresh fetch — a stale proposal can never be served.
 */

import type { ResolvedIntent, GuidedBlueprint } from '@/lib/dashboards/guided-types';

/** Exact key: topic + ordered (term → chosenId) pairs. */
function keyOf(modelId: string, intent: ResolvedIntent): string {
  const choices = (intent.disambiguations ?? [])
    .map((d) => `${d.term}=${d.chosenId ?? ''}`)
    .join('|');
  return `${modelId}::${intent.topic.trim()}::${choices}`;
}

/** The one network call, shared by prefetch and the mount-time fallback. */
export async function fetchBlueprint(modelId: string, intent: ResolvedIntent): Promise<GuidedBlueprint> {
  const res = await fetch(`/api/inspector/semantic/${modelId}/blueprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent }),
  });
  if (!res.ok) throw new Error(`Blueprint request failed: ${res.status}`);
  return (await res.json()) as GuidedBlueprint;
}

// Single-slot cache: only the latest warmed intent is retained. The guided flow
// warms one blueprint at a time, so one slot is sufficient and self-cleaning.
let warmed: { key: string; promise: Promise<GuidedBlueprint> } | null = null;

/**
 * Fire-and-forget warm of the blueprint for this exact intent. No-op if the same
 * intent is already warming. Rejections are swallowed here (so no unhandled
 * rejection surfaces) but preserved on the stored promise for the consumer.
 */
export function prefetchBlueprint(modelId: string, intent: ResolvedIntent): void {
  if (!intent.topic.trim()) return;
  const key = keyOf(modelId, intent);
  if (warmed?.key === key) return;
  const promise = fetchBlueprint(modelId, intent);
  promise.catch(() => {}); // keep the rejection on `promise`; just mark it handled
  warmed = { key, promise };
}

/**
 * Claim the warmed blueprint for EXACTLY this intent, or null on any mismatch
 * (→ caller does a fresh fetch). One-shot: the slot is cleared on read so a later
 * unrelated stage never replays it.
 */
export function consumePrefetchedBlueprint(
  modelId: string,
  intent: ResolvedIntent,
): Promise<GuidedBlueprint> | null {
  if (warmed?.key !== keyOf(modelId, intent)) return null;
  const { promise } = warmed;
  warmed = null;
  return promise;
}
