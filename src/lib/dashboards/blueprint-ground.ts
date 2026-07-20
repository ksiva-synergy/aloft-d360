/**
 * src/lib/dashboards/blueprint-ground.ts
 *
 * Guided Stage 2 (Blueprint) — the grounding core. PURE module: no I/O, no
 * React, no Prisma, no LLM. Given RAW items proposed by the model plus the
 * governed catalog, it produces `ChartBlueprint[]` that is grounded, or refuses.
 *
 * This is "refuse rather than guess" (TIP §4.2) applied to AUTHORING, and the
 * reason the phase exists. The guarantee is enforced HERE, structurally — never
 * by trusting the model:
 *
 *   Every measure/dimension ID in the OUTPUT is a member of the governed
 *   catalog. Any ref the model emits that is not in the catalog is DROPPED — it
 *   can never appear on a ChartBlueprint. A requested metric with no governed
 *   definition is surfaced as a `grounding: 'undefined'` define-it item carrying
 *   the raw term (for the Teach nudge), NOT a fabricated ID.
 *
 * Because the guarantee is a set-membership test done here, it holds even when
 * the model misbehaves and invents an ID — the invented ID is intersected away.
 * That is exactly what the load-bearing grounding test asserts (no invented ID
 * appears anywhere in the response), so keep this module free of any path that
 * emits an ID it did not read out of the catalog.
 *
 * chartKindGuess is a CALL into the shipped recommendChartKind — this module
 * builds the field-combination SemanticQuery + ResolvedDefinitions and delegates;
 * it never re-implements chart-type inference.
 */

import type { SemanticFilter, SemanticQuery } from '@/lib/semantic/types';
import {
  recommendChartKind,
  recommendedKindToWidgetKind,
  type ResolvedDefinitions,
} from './chart-defaults';
import { normalizeTerm } from './intent-resolve';
import type {
  ChartBlueprint,
  ChartKindGuess,
  IntentDisambiguation,
  UndefinedProvenance,
} from './guided-types';

/** A governed catalog field the grounder can resolve a ref to. */
export interface CatalogMeasure {
  id: string;
  label: string;
}
export interface CatalogDimension {
  id: string;
  label: string;
  /** dimension_type (e.g. 'temporal', 'categorical') — drives the time-axis rule. */
  type?: string;
  /** Optional cardinality hint; absent → treated as low-card (safe default → bar). */
  cardinality?: number | 'low' | 'high';
}

/**
 * The GOVERNED-ONLY catalog + the resolved intent (for undefined provenance).
 * Built by the route from the same governed load the definitions/resolve-intent
 * endpoints use (status governed, uncapped) — passed in so this stays pure.
 */
export interface GroundingCatalog {
  measures: CatalogMeasure[];
  dimensions: CatalogDimension[];
  /** From the resolved intent — used to distinguish "genuinely absent" from
   *  "capped past top-K" / "candidate exists" on undefined items (Pin-2). */
  disambiguations?: IntentDisambiguation[];
}

/**
 * One RAW item as proposed by the model (via the propose_blueprint tool). IDs
 * here are UNTRUSTED — validated against the catalog before anything is emitted.
 */
export interface RawBlueprintItem {
  title?: string;
  /** Catalog measure IDs the model selected. Unknown IDs are dropped. */
  measureIds?: string[];
  /** Catalog dimension IDs the model selected. Unknown IDs are dropped. */
  dimensionIds?: string[];
  filters?: SemanticFilter[];
  rationale?: string;
  /**
   * Set by the model when the user's intent needs a metric that is NOT in the
   * catalog — the raw human term (e.g. "near-miss rate"). Yields a define-it
   * item. The model is instructed to use THIS instead of inventing an ID.
   */
  undefinedTerm?: string;
}

/** How many chart items a blueprint may carry (build-plan open question #1). */
export const BLUEPRINT_MIN_ITEMS = 4;
export const BLUEPRINT_MAX_ITEMS = 6;

/** Deterministic id for a blueprint item (index-based; the store may reassign). */
function itemId(index: number): string {
  return `bp_${index}`;
}

/** Look up an undefined term's provenance in the resolved intent's disambiguations. */
function provenanceForTerm(
  term: string,
  disambiguations: IntentDisambiguation[] | undefined,
): UndefinedProvenance | undefined {
  if (!disambiguations?.length) return undefined;
  const n = normalizeTerm(term);
  const hit = disambiguations.find((d) => normalizeTerm(d.term) === n);
  if (!hit) return undefined;
  const prov: UndefinedProvenance = {};
  // A real-but-not-promoted field matched → "govern it", not "define from scratch".
  if (hit.resolution === 'not_governed') prov.candidateExists = true;
  // Absence unproven — a Phase-2 embedding assist hit its top-K cap. Do NOT
  // present this as genuinely absent (Pin-2 trap).
  if (hit.cappedByTopK) prov.cappedByTopK = true;
  return Object.keys(prov).length ? prov : undefined;
}

/**
 * Ground one raw item into a ChartBlueprint, or return null to DROP it (the
 * model produced nothing groundable and no term to define — we refuse rather
 * than emit an empty or fabricated chart).
 */
function groundItem(
  raw: RawBlueprintItem,
  index: number,
  measureById: Map<string, CatalogMeasure>,
  dimById: Map<string, CatalogDimension>,
  resolvedDefs: ResolvedDefinitions,
  disambiguations: IntentDisambiguation[] | undefined,
): ChartBlueprint | null {
  const title = (raw.title ?? '').trim() || `Chart ${index + 1}`;
  const rationale = (raw.rationale ?? '').trim();

  // ── Intersect refs with the governed catalog — the guarantee. ──────────────
  // Anything not in the catalog is dropped and can never reach the output.
  const validMeasures = (raw.measureIds ?? [])
    .map((id) => measureById.get(id))
    .filter((m): m is CatalogMeasure => !!m);
  const validDims = (raw.dimensionIds ?? [])
    .map((id) => dimById.get(id))
    .filter((d): d is CatalogDimension => !!d);
  const droppedMeasureCount = (raw.measureIds ?? []).length - validMeasures.length;

  const measureIds = validMeasures.map((m) => m.id);
  const dimensionIds = validDims.map((d) => d.id);
  const measureLabels = validMeasures.map((m) => m.label);
  const dimensionLabels = validDims.map((d) => d.label);

  // chartKindGuess — a CALL into the shipped recommender over the VALID field
  // combination (grounded IDs only), never re-implemented here.
  const query: SemanticQuery = {
    modelId: '', // combination-shape only; recommendChartKind ignores modelId
    entityId: '',
    dimensions: dimensionIds.map((dimensionId) => ({ dimensionId })),
    measures: measureIds.map((measureId) => ({ measureId })),
    filters: [],
    sorts: [],
  };
  const chartKindGuess = recommendChartKind(query, resolvedDefs).chartKind as ChartKindGuess;

  // Filters obey the same guarantee: a filter whose fieldId isn't a governed
  // dimension/measure is dropped (never a fabricated field reference).
  const filters: SemanticFilter[] = (Array.isArray(raw.filters) ? raw.filters : []).filter((f) =>
    f && typeof f === 'object'
      ? f.fieldKind === 'measure'
        ? measureById.has(f.fieldId)
        : dimById.has(f.fieldId)
      : false,
  );

  // ── Two-state grounding decision ───────────────────────────────────────────
  // 'undefined' iff the model declared a missing term, OR it referenced a
  // metric that dropped away (fabricated / non-governed), OR nothing grounded to
  // a measure at all. Otherwise 'governed'.
  const declaredTerm = (raw.undefinedTerm ?? '').trim();
  const hasValidMeasure = measureIds.length > 0;

  if (declaredTerm || droppedMeasureCount > 0 || !hasValidMeasure) {
    // The requested-but-ungrounded term. Prefer the model's explicit term; else
    // fall back to the title so a fabricated ID never yields a silent chart and
    // never vanishes without a visible define-it row.
    const undefinedTerm = declaredTerm || title;

    // A degenerate case: the model gave neither a term, nor any valid field, nor
    // a droppable ref — there's nothing to define and nothing to show. Refuse.
    if (!declaredTerm && droppedMeasureCount === 0 && !hasValidMeasure && dimensionIds.length === 0) {
      return null;
    }

    return {
      id: itemId(index),
      title,
      measureIds,        // ⊆ catalog (may be empty for a pure define-it row)
      dimensionIds,      // ⊆ catalog — partial grounding is kept (e.g. valid breakdown)
      measureLabels,
      dimensionLabels,
      filters,
      chartKindGuess,
      rationale,
      grounding: 'undefined',
      undefinedTerm,
      undefinedProvenance: provenanceForTerm(undefinedTerm, disambiguations),
    };
  }

  return {
    id: itemId(index),
    title,
    measureIds,
    dimensionIds,
    measureLabels,
    dimensionLabels,
    filters,
    chartKindGuess,
    rationale,
    grounding: 'governed',
  };
}

/**
 * Ground a raw model proposal into a curated-ready ChartBlueprint[].
 *
 * Guarantees (all structural, model-independent):
 *   - every measureId/dimensionId in the result is a member of the catalog;
 *   - a requested-but-undefined metric becomes a `grounding: 'undefined'` item
 *     carrying `undefinedTerm` (+ cap-aware provenance), never a fabricated ID;
 *   - each item's `chartKindGuess` comes from recommendChartKind;
 *   - the list is capped at BLUEPRINT_MAX_ITEMS (excess dropped — the caller
 *     surfaces the cap; we never silently claim more coverage than shown).
 */
export function groundBlueprint(
  rawItems: RawBlueprintItem[],
  catalog: GroundingCatalog,
): ChartBlueprint[] {
  const measureById = new Map(catalog.measures.map((m) => [m.id, m]));
  const dimById = new Map(catalog.dimensions.map((d) => [d.id, d]));

  // ResolvedDefinitions for recommendChartKind — types drive the time-axis rule;
  // cardinality is intentionally absent (no COUNT(DISTINCT) probe here) → the
  // recommender's documented safe default (bar, never pie).
  const resolvedDefs: ResolvedDefinitions = {
    dimensions: Object.fromEntries(
      catalog.dimensions.map((d) => [d.id, { id: d.id, type: d.type, cardinality: d.cardinality }]),
    ),
    measures: Object.fromEntries(catalog.measures.map((m) => [m.id, { id: m.id }])),
  };

  const grounded: ChartBlueprint[] = [];
  for (let i = 0; i < rawItems.length && grounded.length < BLUEPRINT_MAX_ITEMS; i++) {
    const item = groundItem(rawItems[i], grounded.length, measureById, dimById, resolvedDefs, catalog.disambiguations);
    if (item) grounded.push(item);
  }
  return grounded;
}

/** Re-export so the widget-mapping layer can narrow a guess to a widget kind. */
export { recommendedKindToWidgetKind };
