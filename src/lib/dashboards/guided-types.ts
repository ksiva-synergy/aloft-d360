/**
 * src/lib/dashboards/guided-types.ts
 *
 * Types for the guided dashboard-creation flow (NL-first authoring).
 *
 * `ResolvedIntent` is the Stage-1 output: what the user wants the dashboard to
 * answer, the semantic model it binds to, the governed measures/dimensions that
 * matter, and — critically — how each ambiguous term in the topic resolved.
 * It is emitted into `guidedSession.intent` on the shared builder store and
 * consumed by Stage 2 (Blueprint). No charts here — Intent never picks charts.
 *
 * Pinned to the prototype + the Phase-0 contract reconciliation:
 *   - disambiguation candidates carry { id, label, description } (NOT bare ids),
 *     because the resolver strip renders label + description per candidate;
 *   - the resolution field has FOUR distinct states, because a term can fail to
 *     resolve for four visibly-different reasons (see IntentResolution).
 */

/**
 * How a single term in the user's topic resolved against the governed catalog.
 * These MUST render as visibly distinct states — collapsing them to one red
 * underline is the failure the four-state design exists to prevent.
 *
 *  - 'matched'      → exactly one governed field. Solid underline.
 *  - 'ambiguous'    → several governed candidates. Amber underline → chooser.
 *  - 'not_governed' → the term matches a real definition that exists but is only
 *                     a *candidate* (not promoted). NOT "unrecognized": the field
 *                     is real, just not governed yet → nudge toward governing /
 *                     defining it in Teach.
 *  - 'unrecognized' → genuinely no match anywhere. Red underline.
 */
export type IntentResolution = 'matched' | 'ambiguous' | 'not_governed' | 'unrecognized';

/** A governed/candidate field offered as a disambiguation candidate. */
export interface IntentCandidate {
  id: string;
  label: string;
  description?: string;
}

export interface IntentDisambiguation {
  /** The term from the topic, verbatim. */
  term: string;
  candidates: IntentCandidate[];
  /** Set once the user picks (or an auto-resolve fires) for an ambiguous term. */
  chosenId?: string;
  resolution: IntentResolution;
  /**
   * True when we could NOT prove the term is truly absent because the embedding
   * assist hit its top-K cap (Pin-2 trap). A capped-but-real match must never be
   * reported as a plain 'unrecognized' — the UI surfaces this as a distinct
   * "search may be truncated" note, and the resolver logs it rather than
   * silently swallowing it.
   */
  cappedByTopK?: boolean;
}

export interface ResolvedIntent {
  /** Confirmed semantic model — one dashboard = one model. */
  modelId: string;
  /** The user's decision/question, verbatim. */
  topic: string;
  relevantMeasureIds: string[];
  relevantDimensionIds: string[];
  disambiguations?: IntentDisambiguation[];
}
