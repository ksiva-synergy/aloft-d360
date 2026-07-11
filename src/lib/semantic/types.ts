/**
 * src/lib/semantic/types.ts
 *
 * Single source of truth for all semantic-layer types.
 * compiler.ts and execute.ts both import from here — zero duplication.
 */

// ── DimRef / MeasureRef ───────────────────────────────────────────────────────

export interface DimRef {
  /** References platform_sem_dimensions.id */
  dimensionId: string;
  /**
   * Per-dimension time grain for temporal dimensions.
   * Overrides SemanticQuery.timeGrain when set.
   */
  timeGrain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface MeasureRef {
  /** References platform_sem_measures.id */
  measureId: string;
}

// ── Filters / Sorts ───────────────────────────────────────────────────────────

export type FilterOp =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in'
  | 'between'
  | 'is_null' | 'is_not_null';

export interface SemanticFilter {
  /** Dimension ID or measure ID being filtered */
  fieldId: string;
  fieldKind: 'dimension' | 'measure';
  op: FilterOp;
  /** Type depends on op — array for 'in' / 'not_in' / 'between' */
  value: unknown;
}

export interface SemanticSort {
  fieldId: string;
  fieldKind: 'dimension' | 'measure';
  direction: 'asc' | 'desc';
}

// ── SemanticQuery ─────────────────────────────────────────────────────────────

/**
 * Structured query contract emitted by the agent instead of raw SQL.
 *
 * TimeGrain precedence: DimRef.timeGrain (per-dimension) overrides
 * SemanticQuery.timeGrain (global). The global grain applies to all temporal
 * dimensions that do not specify their own. Non-temporal dimensions ignore both.
 */
export interface SemanticQuery {
  /** References platform_semantic_models.id */
  modelId: string;
  /** Primary entity — references platform_sem_entities.id */
  entityId: string;
  dimensions: DimRef[];
  measures: MeasureRef[];
  filters: SemanticFilter[];
  sorts: SemanticSort[];
  /** Row cap — default 1000, max 10000 */
  limit?: number;
  /** Global time grain override; per-dim grain takes precedence */
  timeGrain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

// ── SemanticModel (loaded from Prisma for the compiler) ───────────────────────

export interface SemanticModelEntity {
  id: string;
  full_path: string;
  entity_label: string;
}

export interface SemanticModelDimension {
  id: string;
  entity_id: string;
  column_name: string;
  dimension_label: string;
  dimension_type: string;
}

export interface SemanticModelMeasure {
  id: string;
  entity_id: string;
  /** Nullable — NULL for derived metrics that use expression only */
  column_name: string | null;
  measure_label: string;
  aggregate: string;
  expression: string | null;
  metric_type: string;
}

export interface SemanticModelJoin {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  join_type: string;
  join_on_sql: string;
}

export interface SemanticModel {
  id: string;
  entities: SemanticModelEntity[];
  dimensions: SemanticModelDimension[];
  measures: SemanticModelMeasure[];
  joins: SemanticModelJoin[];
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SemanticValidationError {
  /** The offending ID */
  field: string;
  /** e.g. 'dimensions[0].dimensionId', 'filters[1].fieldId' */
  location: string;
  /** e.g. 'Dimension ID not found in model' */
  reason: string;
}

export interface SemanticValidationResult {
  valid: boolean;
  errors: SemanticValidationError[];
}

/**
 * Validates that every ID referenced in the query exists in the loaded model.
 * Does NOT check modelId (caller resolves the model).
 *
 * Checks:
 *  1. entityId exists in model.entities
 *  2. Every dimensions[].dimensionId exists in model.dimensions
 *  3. Every measures[].measureId exists in model.measures
 *  4. Every filters[].fieldId exists as a dimension or measure matching fieldKind
 *  5. Every sorts[].fieldId exists as a dimension or measure matching fieldKind
 */
export function validateSemanticQuery(
  query: SemanticQuery,
  model: {
    entities: Pick<SemanticModelEntity, 'id'>[];
    dimensions: Pick<SemanticModelDimension, 'id' | 'entity_id'>[];
    measures: Pick<SemanticModelMeasure, 'id' | 'entity_id'>[];
  },
): SemanticValidationResult {
  const errors: SemanticValidationError[] = [];

  const entityIds = new Set(model.entities.map((e) => e.id));
  const dimIds = new Set(model.dimensions.map((d) => d.id));
  const measureIds = new Set(model.measures.map((m) => m.id));

  // 1. Primary entity
  if (!entityIds.has(query.entityId)) {
    errors.push({
      field: query.entityId,
      location: 'entityId',
      reason: `Entity ID '${query.entityId}' not found in model`,
    });
  }

  // 2. Dimensions
  for (let i = 0; i < query.dimensions.length; i++) {
    const ref = query.dimensions[i];
    if (!dimIds.has(ref.dimensionId)) {
      errors.push({
        field: ref.dimensionId,
        location: `dimensions[${i}].dimensionId`,
        reason: `Dimension ID '${ref.dimensionId}' not found in model`,
      });
    }
  }

  // 3. Measures
  for (let i = 0; i < query.measures.length; i++) {
    const ref = query.measures[i];
    if (!measureIds.has(ref.measureId)) {
      errors.push({
        field: ref.measureId,
        location: `measures[${i}].measureId`,
        reason: `Measure ID '${ref.measureId}' not found in model`,
      });
    }
  }

  // 4. Filters
  for (let i = 0; i < query.filters.length; i++) {
    const f = query.filters[i];
    if (f.fieldKind === 'dimension' && !dimIds.has(f.fieldId)) {
      errors.push({
        field: f.fieldId,
        location: `filters[${i}].fieldId`,
        reason: `Dimension ID '${f.fieldId}' not found in model`,
      });
    } else if (f.fieldKind === 'measure' && !measureIds.has(f.fieldId)) {
      errors.push({
        field: f.fieldId,
        location: `filters[${i}].fieldId`,
        reason: `Measure ID '${f.fieldId}' not found in model`,
      });
    }
  }

  // 5. Sorts
  for (let i = 0; i < query.sorts.length; i++) {
    const s = query.sorts[i];
    if (s.fieldKind === 'dimension' && !dimIds.has(s.fieldId)) {
      errors.push({
        field: s.fieldId,
        location: `sorts[${i}].fieldId`,
        reason: `Dimension ID '${s.fieldId}' not found in model`,
      });
    } else if (s.fieldKind === 'measure' && !measureIds.has(s.fieldId)) {
      errors.push({
        field: s.fieldId,
        location: `sorts[${i}].fieldId`,
        reason: `Measure ID '${s.fieldId}' not found in model`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
