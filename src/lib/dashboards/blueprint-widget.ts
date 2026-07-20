/**
 * src/lib/dashboards/blueprint-widget.ts
 *
 * Guided Stage 2 → Stage 4 contract: ChartBlueprint → WidgetSpec (Appendix C).
 *
 * PURE, type-level mapping. It does NOT execute, render, or freeze snapshots —
 * it defines HOW an accepted blueprint item becomes a widget spec, wired at
 * accept/pin (not at execution). The heavy, trust-bearing steps happen elsewhere:
 *   - measureSnapshots are RE-FROZEN SERVER-SIDE at pin (never client-supplied)
 *     — this mapper emits an empty snapshot array as a placeholder;
 *   - the defensive pin (`semanticQuery.modelId = dashboard.model_id`) is honored
 *     by REQUIRING the model id as an argument (carried on GuidedBlueprint), so a
 *     stale stored value can never leak in.
 *
 * Only a `grounding: 'governed'` item maps to a widget. An 'undefined' item is a
 * define-it placeholder with no governed measure — mapping it would fabricate a
 * chart with no data, so it returns null (the caller keeps it as a Teach nudge).
 */

import type { SemanticWidgetSpec, MeasureSnapshot } from './types';
import type { SemanticQuery } from '@/lib/semantic/types';
import { recommendedKindToWidgetKind } from './chart-defaults';
import type { ChartBlueprint, ChartKindGuess } from './guided-types';

/** Placeholder grid position — real layout is assigned in the assemble phase. */
const PLACEHOLDER_POSITION = { col: 0, row: 0, w: 6, h: 4 } as const;

export interface BlueprintPinBinding {
  /**
   * The DASHBOARD's semantic model id. MUST be `dashboard.model_id` at pin/fetch
   * time — the defensive pin (TIP §2.1). Carried on `GuidedBlueprint.modelId`;
   * pass it explicitly so this mapper never trusts a value stored on the item.
   */
  modelId: string;
  /**
   * Primary entity for the query. Resolved by the caller at pin time from the
   * grounded fields' entity (the blueprint carries field IDs, not the entity).
   */
  entityId: string;
  /** Stable widget identity (cuid2). Supplied by the caller so this stays pure. */
  widgetId: string;
  /** Optional chat-chart provenance back-ref, iff promoted from a chat chart. */
  sourceChartId?: string;
}

/** Narrow a blueprint chart-kind guess to a first-class widget kind. */
function guessToWidgetKind(guess: ChartKindGuess): SemanticWidgetSpec['chartKind'] {
  return recommendedKindToWidgetKind(guess);
}

/**
 * Map an ACCEPTED, governed blueprint item to a draft SemanticWidgetSpec.
 *
 * Returns null for an 'undefined' item (no governed measure to bind — never
 * fabricate a widget). The returned spec is a DRAFT: `measureSnapshots` is empty
 * and is re-frozen server-side at pin.
 */
export function blueprintToWidgetSpec(
  bp: ChartBlueprint,
  binding: BlueprintPinBinding,
): SemanticWidgetSpec | null {
  if (bp.grounding !== 'governed') return null;

  const semanticQuery: SemanticQuery = {
    // Defensive pin: the dashboard's model, passed in — NOT a stored value.
    modelId: binding.modelId,
    entityId: binding.entityId,
    // Live ID references — labels stay live via the semantic layer.
    dimensions: bp.dimensionIds.map((dimensionId) => ({ dimensionId })),
    measures: bp.measureIds.map((measureId) => ({ measureId })),
    // Governed filters (not row hacks); editable in the Phase-4 drill-in.
    filters: bp.filters,
    sorts: [],
  };

  const spec: SemanticWidgetSpec = {
    widgetId: binding.widgetId,
    title: bp.title,
    chartSource: 'semantic',
    chartKind: guessToWidgetKind(bp.chartKindGuess),
    chartConfig: {},
    // Re-frozen server-side at pin — empty placeholder here (never client-authoritative).
    measureSnapshots: [] as MeasureSnapshot[],
    semanticQuery,
    position: { ...PLACEHOLDER_POSITION },
  };
  if (binding.sourceChartId) spec.source_chart_id = binding.sourceChartId;
  return spec;
}
