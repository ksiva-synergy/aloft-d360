/**
 * src/lib/semantic/authoring-draft.ts
 *
 * Phase 3.5B — pure logic for the "Define a Metric" authoring surface.
 * No I/O; fully unit-testable. Three concerns:
 *
 *   1. validateDraftInput  — shape/field rules for a new draft measure or
 *      dimension, including the compileSafety guard on authored expressions
 *      (no raw-SQL authoring of measure expressions).
 *   2. buildDraftPreviewQuery — assemble a SemanticQuery for the live
 *      authoring-mode preview from the current form selection.
 *   3. decideEditGate — the deliverable-6 edit gate: own draft is free,
 *      candidate/governed edits are reputation-gated, and a governed edit
 *      forces a demotion back to candidate for re-review.
 *
 * Shared vocab (AGGREGATES / METRIC_TYPES / DIMENSION_TYPES) is exported so the
 * form dropdowns and the server validator agree on one source of truth.
 */

import { compileSafety } from './compiler';
import type { SemanticQuery } from './types';

// ── Shared vocabulary (form dropdowns ↔ validator) ──────────────────────────

export const AGGREGATES = ['sum', 'mean', 'count', 'count_distinct', 'min', 'max', 'median'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export const METRIC_TYPES = ['simple', 'cumulative', 'ratio', 'derived'] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const DIMENSION_TYPES = ['categorical', 'temporal', 'numeric', 'boolean'] as const;
export type DimensionType = (typeof DIMENSION_TYPES)[number];

/** metric_types whose value comes from an aggregate over a physical column. */
const COLUMN_METRIC_TYPES: MetricType[] = ['simple', 'cumulative'];
/** metric_types whose value comes from a free-text SQL expression. */
const EXPRESSION_METRIC_TYPES: MetricType[] = ['ratio', 'derived'];

// ── Input shapes ─────────────────────────────────────────────────────────────

export interface DraftMeasureInput {
  entity_id: string;
  measure_label: string;
  metric_type: string;
  aggregate?: string | null;
  column_name?: string | null;
  expression?: string | null;
  unit?: string | null;
  format_hint?: string | null;
  nl_intent?: string | null;
}

export interface DraftDimensionInput {
  entity_id: string;
  dimension_label: string;
  dimension_type: string;
  column_name: string;
  format_hint?: string | null;
  nl_intent?: string | null;
}

export interface DraftValidation {
  valid: boolean;
  errors: string[];
}

// ── validateDraftInput ────────────────────────────────────────────────────────

/**
 * Validate a draft-create payload for a measure. Enforces the metric_type
 * contract the compiler relies on:
 *   simple/cumulative → aggregate + column_name required, no expression
 *   ratio/derived     → expression required (compileSafety-checked), no column/agg needed
 * A missing entity or label always fails.
 */
export function validateDraftMeasure(input: DraftMeasureInput): DraftValidation {
  const errors: string[] = [];

  if (!input.entity_id) errors.push('entity is required');
  if (!input.measure_label || !input.measure_label.trim()) errors.push('label is required');

  const metricType = input.metric_type as MetricType;
  if (!METRIC_TYPES.includes(metricType)) {
    errors.push(`metric type must be one of: ${METRIC_TYPES.join(', ')}`);
    return { valid: errors.length === 0, errors };
  }

  if (COLUMN_METRIC_TYPES.includes(metricType)) {
    if (!input.column_name || !input.column_name.trim()) {
      errors.push(`${metricType} metrics require a column`);
    }
    if (!input.aggregate || !AGGREGATES.includes(input.aggregate as Aggregate)) {
      errors.push(`${metricType} metrics require an aggregate (${AGGREGATES.join(', ')})`);
    }
  }

  if (EXPRESSION_METRIC_TYPES.includes(metricType)) {
    if (!input.expression || !input.expression.trim()) {
      errors.push(`${metricType} metrics require an expression`);
    } else {
      const safety = compileSafety(input.expression);
      if (!safety.safe) errors.push(safety.reason ?? 'expression rejected by safety check');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate a draft-create payload for a dimension. */
export function validateDraftDimension(input: DraftDimensionInput): DraftValidation {
  const errors: string[] = [];
  if (!input.entity_id) errors.push('entity is required');
  if (!input.dimension_label || !input.dimension_label.trim()) errors.push('label is required');
  if (!input.column_name || !input.column_name.trim()) errors.push('column is required');
  if (input.dimension_type && !DIMENSION_TYPES.includes(input.dimension_type as DimensionType)) {
    errors.push(`dimension type must be one of: ${DIMENSION_TYPES.join(', ')}`);
  }
  return { valid: errors.length === 0, errors };
}

// ── buildDraftPreviewQuery ─────────────────────────────────────────────────────

export interface PreviewQueryInput {
  modelId: string;
  entityId: string;
  /** The draft measure being previewed (already persisted → has an id). */
  measureId?: string | null;
  /** Optional dimension to group by so a measure renders as a series, not a scalar. */
  groupByDimensionId?: string | null;
  limit?: number;
}

/**
 * Assemble a SemanticQuery for the authoring-mode preview. Kept intentionally
 * minimal — no filters/sorts — because the point is to show the draft
 * definition computing against real data, not to reproduce a full analysis.
 */
export function buildDraftPreviewQuery(input: PreviewQueryInput): SemanticQuery {
  return {
    modelId: input.modelId,
    entityId: input.entityId,
    dimensions: input.groupByDimensionId ? [{ dimensionId: input.groupByDimensionId }] : [],
    measures: input.measureId ? [{ measureId: input.measureId }] : [],
    filters: [],
    sorts: [],
    limit: input.limit ?? 100,
  };
}

// ── Snapshot-relevant (computation) fields ──────────────────────────────────

export type EditTableKind = 'entity' | 'dimension' | 'measure';

/**
 * The fields whose edit changes the *numbers a definition produces* — i.e. the
 * fields dashboards freeze and drift-check against. For measures this set MUST
 * mirror MeasureSnapshot ({ aggregate, expression, metric_type }): if a field
 * is in the snapshot, editing it must demote a governed def; if it isn't, the
 * edit is cosmetic and the def stays governed. Keeping this list tied to the
 * snapshot is what prevents the demotion rule and the drift detector from
 * silently diverging.
 *
 *   measure   → aggregate | expression | metric_type   (== MeasureSnapshot)
 *   dimension → column_name | dimension_type            (affect the compiled SQL)
 *   entity    → (none editable via ALLOWED_EDIT_FIELDS is computation-relevant;
 *                full_path is structural and not editable)
 */
export const SNAPSHOT_RELEVANT_FIELDS: Record<EditTableKind, readonly string[]> = {
  measure: ['aggregate', 'expression', 'metric_type'],
  dimension: ['column_name', 'dimension_type'],
  entity: [],
};

/** True iff any edited field changes the definition's compiled output. */
export function touchesComputation(tableKind: EditTableKind, changedFields: string[]): boolean {
  const relevant = SNAPSHOT_RELEVANT_FIELDS[tableKind] ?? [];
  return changedFields.some((f) => relevant.includes(f));
}

// ── decideEditGate (deliverable 6) ─────────────────────────────────────────────

export interface EditGateInput {
  /** Current status of the definition being edited. */
  status: string;
  /** created_by === caller AND status === 'draft'. */
  isOwnDraft: boolean;
  /** Caller holds an admin RBAC role. */
  isAdmin: boolean;
  /** Caller's authoring reputation clears the self-approve bar. */
  canSelfApprove: boolean;
  /**
   * Whether this edit changes a snapshot-relevant (computation) field. A
   * governed def is demoted to candidate ONLY when this is true — a cosmetic
   * edit (label / description / synonyms / unit / format) changes no numbers,
   * so it stays governed and no dashboard drift is triggered.
   */
  touchesComputation: boolean;
}

export interface EditGateDecision {
  allowed: boolean;
  /**
   * True only for a governed definition being edited: the edit applies but the
   * definition is forced back to 'candidate' so the changed numbers must
   * re-earn governance before dashboards trust them again.
   */
  forceDemotion: boolean;
  reason: string;
}

/**
 * The edit gate. Mirrors the promotion gate's bar for non-draft edits:
 *
 *   archived            → never editable (retired)
 *   own draft           → free (not trusted; nothing depends on it)
 *   another user's draft → forbidden (drafts are owner-only)
 *   candidate           → admin OR self-approve reputation
 *   governed            → admin OR self-approve reputation, AND demote to
 *                         candidate for re-review (silently editing a governed
 *                         measure would change everyone's numbers with no
 *                         re-validation — see deliverable 6 rationale).
 */
export function decideEditGate(input: EditGateInput): EditGateDecision {
  const { status, isOwnDraft, isAdmin, canSelfApprove, touchesComputation: touchesComp } = input;

  if (status === 'archived') {
    return { allowed: false, forceDemotion: false, reason: 'archived definitions cannot be edited' };
  }

  if (status === 'draft') {
    return isOwnDraft
      ? { allowed: true, forceDemotion: false, reason: 'own draft — free edit' }
      : { allowed: false, forceDemotion: false, reason: 'this draft belongs to another user' };
  }

  // candidate | governed — reputation-gated (same bar as promotion), regardless
  // of whether the edit is cosmetic. The gate protects who may touch a
  // non-draft def; the demotion below decides whether the numbers changed.
  const gatePass = isAdmin || canSelfApprove;
  if (!gatePass) {
    return {
      allowed: false,
      forceDemotion: false,
      reason: `editing a ${status} definition requires admin approval or sufficient authoring reputation`,
    };
  }

  if (status === 'governed') {
    // Demote ONLY when a snapshot-relevant field changed — a cosmetic edit
    // (label/description/synonyms/unit/format) changes no numbers, so the def
    // stays governed and no dashboard drift is triggered.
    return touchesComp
      ? { allowed: true, forceDemotion: true, reason: 'governed definition edited (computation changed) — demoted to candidate for re-governance' }
      : { allowed: true, forceDemotion: false, reason: 'governed definition edited (cosmetic) — remains governed' };
  }

  return { allowed: true, forceDemotion: false, reason: `${status} definition edited` };
}
