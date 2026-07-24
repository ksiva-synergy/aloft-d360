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

/* ────────────────────────────────────────────────────────────────────────────
 * Stage 2 — Blueprint (Phase 3)
 *
 * The blueprint is a reviewable OUTLINE of 4–6 proposed charts the user curates
 * before anything is built. Nothing here is executed or rendered — a
 * ChartBlueprint is a spec, not a live chart (that's Phase 4 drill-in).
 *
 * Pinned to the Phase-0 contract reconciliation, NOT the build-plan's Appendix B
 * three-state draft:
 *   - grounding is TWO-STATE per item ('governed' | 'undefined'); candidate-ness
 *     is a MODEL-level property (one dashboard = one model) carried on
 *     `GuidedBlueprint.modelStatus` for a banner, never per row;
 *   - resolved display labels ride BESIDE the IDs so a card renders "Accident
 *     count" / "by Root cause category" with no second lookup;
 *   - an undefined item carries the raw `undefinedTerm` to prefill the Teach
 *     nudge, plus cap-aware provenance so a capped-but-real metric (Pin-2 trap)
 *     is not mis-surfaced as genuinely-absent.
 * ──────────────────────────────────────────────────────────────────────────── */

import type { SemanticFilter } from '@/lib/semantic/types';

/**
 * Chart kinds a blueprint item can guess. This is the recommender's output type
 * (`RecommendedChartKind` in chart-defaults.ts) — a SUPERSET of
 * `WidgetSpec['chartKind']`: 'pie'/'table' have no first-class widget and are
 * mapped to a widget kind only at pin time. Kept as its own alias so the
 * blueprint layer never silently narrows the guess.
 */
export type ChartKindGuess =
  | 'line' | 'bar' | 'scatter' | 'kpi' | 'pie' | 'heatmap' | 'table';

/**
 * Two-state grounding for a single blueprint item.
 *   - 'governed'  → every field resolved to a real governed definition ID.
 *   - 'undefined' → a requested metric/breakdown has NO governed definition; the
 *                   item is a "define-it" placeholder, never a fabricated ID.
 * (Candidate-ness is model-level — see `GuidedBlueprint.modelStatus`.)
 */
export type BlueprintGrounding = 'governed' | 'undefined';

/** Model-level governance state, for the whole-blueprint banner (not per row). */
export type BlueprintModelStatus = 'governed' | 'candidate';

/**
 * Provenance for an `undefined` item, so the UI can tell three visibly-different
 * situations apart instead of blanket-nudging "define it in Teach":
 *   - genuinely absent (default: neither flag set) → "not defined — define it";
 *   - `candidateExists` → a real but not-yet-promoted def exists → "govern it";
 *   - `cappedByTopK` → absence UNPROVEN (a Phase-2 embedding assist hit its
 *     top-K cap); a real governed match may exist past the cap → do NOT assert
 *     absence. Mirrors `IntentDisambiguation.cappedByTopK` — seeded from the
 *     resolved intent rather than re-derived (Pin-2 trap).
 */
export interface UndefinedProvenance {
  candidateExists?: boolean;
  cappedByTopK?: boolean;
}

export interface ChartBlueprint {
  id: string;
  title: string;
  measureIds: string[];
  dimensionIds: string[];
  /** Resolved labels beside the IDs so the card needs no second lookup. */
  measureLabels: string[];
  dimensionLabels: string[];
  /** Inferred at proposal; editable in the Phase-4 drill-in. */
  filters: SemanticFilter[];
  /** From recommendChartKind — a CALL into the shipped recommender, not new inference. */
  chartKindGuess: ChartKindGuess;
  /** One line, "why this chart". */
  rationale: string;
  /** Two-state; candidate-ness is model-level, never here. */
  grounding: BlueprintGrounding;
  /** Raw requested term — prefill for the inline define nudge. Set iff grounding==='undefined'. */
  undefinedTerm?: string;
  /** Cap-aware provenance for an undefined item (see UndefinedProvenance). */
  undefinedProvenance?: UndefinedProvenance;
  /**
   * Inline-authoring ladder state for a metric the user defined FROM this card
   * (Request 2). Held ON the item so it rides `guidedSession.blueprint` and
   * survives a "Back to intent" round-trip / reload — never in ephemeral React
   * state. `tier` tracks how far up the draft → candidate → governed ladder the
   * new definition has climbed:
   *   - 'draft'     → created, private to the author, NOT yet grounded (a draft is
   *                   invisible to the shared blueprint/resolve loads);
   *   - 'candidate' → submitted for governance; the item is flipped to grounded;
   *   - 'governed'  → promoted (reputation-gated; admin-only in practice day one).
   */
  pendingDefinition?: PendingDefinition;
}

/** Inline-authoring ladder state carried on a ChartBlueprint (Request 2). */
export interface PendingDefinition {
  id: string;
  tableKind: 'measure' | 'dimension';
  label: string;
  tier: 'draft' | 'candidate' | 'governed';
}

/**
 * The guided-session blueprint slice: the curated item list plus the model-level
 * governance banner state. Held on the ONE shared builder store — no parallel tree.
 */
export interface GuidedBlueprint {
  /** Carried so the defensive pin (semanticQuery.modelId = dashboard.model_id)
   *  can hold at Phase-4/pin time without trusting a stored value later. */
  modelId: string;
  items: ChartBlueprint[];
  /** Whole-model banner — 'candidate' when the bound model isn't governed yet. */
  modelStatus: BlueprintModelStatus;
}
