import {
  validateDraftMeasure,
  validateDraftDimension,
  buildDraftPreviewQuery,
  decideEditGate,
  touchesComputation,
  SNAPSHOT_RELEVANT_FIELDS,
  AGGREGATES,
  METRIC_TYPES,
} from '../authoring-draft';

describe('validateDraftMeasure', () => {
  const base = { entity_id: 'e1', measure_label: 'Net Revenue' };

  it('accepts a simple measure with aggregate + column', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'simple', aggregate: 'sum', column_name: 'revenue' });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a simple measure missing a column', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'simple', aggregate: 'sum' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('column'))).toBe(true);
  });

  it('rejects a simple measure with a bad aggregate', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'simple', aggregate: 'nonsense', column_name: 'revenue' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('aggregate'))).toBe(true);
  });

  it('accepts a ratio measure with a safe expression', () => {
    const r = validateDraftMeasure({
      ...base,
      metric_type: 'ratio',
      expression: 'SUM(revenue) / NULLIF(SUM(orders), 0)',
    });
    expect(r.valid).toBe(true);
  });

  it('rejects a ratio measure missing an expression', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'ratio' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('expression'))).toBe(true);
  });

  it('rejects a derived measure whose expression contains a DDL token (compileSafety)', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'derived', expression: 'DROP TABLE orders' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toUpperCase().includes('DROP'))).toBe(true);
  });

  it('rejects an unknown metric type', () => {
    const r = validateDraftMeasure({ ...base, metric_type: 'weird' });
    expect(r.valid).toBe(false);
  });

  it('requires entity + label', () => {
    const r = validateDraftMeasure({ entity_id: '', measure_label: '', metric_type: 'simple', aggregate: 'sum', column_name: 'x' });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateDraftDimension', () => {
  it('accepts a valid categorical dimension', () => {
    const r = validateDraftDimension({ entity_id: 'e1', dimension_label: 'Region', dimension_type: 'categorical', column_name: 'region' });
    expect(r.valid).toBe(true);
  });

  it('rejects a dimension without a column', () => {
    const r = validateDraftDimension({ entity_id: 'e1', dimension_label: 'Region', dimension_type: 'categorical', column_name: '' });
    expect(r.valid).toBe(false);
  });

  it('rejects a bad dimension type', () => {
    const r = validateDraftDimension({ entity_id: 'e1', dimension_label: 'Region', dimension_type: 'nope', column_name: 'region' });
    expect(r.valid).toBe(false);
  });
});

describe('buildDraftPreviewQuery', () => {
  it('builds a scalar preview (measure only, no group-by)', () => {
    const q = buildDraftPreviewQuery({ modelId: 'm1', entityId: 'e1', measureId: 'meas1' });
    expect(q.measures).toEqual([{ measureId: 'meas1' }]);
    expect(q.dimensions).toEqual([]);
    expect(q.modelId).toBe('m1');
    expect(q.limit).toBe(100);
  });

  it('adds a group-by dimension when provided', () => {
    const q = buildDraftPreviewQuery({ modelId: 'm1', entityId: 'e1', measureId: 'meas1', groupByDimensionId: 'dim1' });
    expect(q.dimensions).toEqual([{ dimensionId: 'dim1' }]);
  });
});

describe('touchesComputation', () => {
  it('measure snapshot fields mirror MeasureSnapshot', () => {
    expect(SNAPSHOT_RELEVANT_FIELDS.measure).toEqual(['aggregate', 'expression', 'metric_type']);
  });

  it('measure: aggregate/expression/metric_type are computation-relevant', () => {
    expect(touchesComputation('measure', ['aggregate'])).toBe(true);
    expect(touchesComputation('measure', ['expression'])).toBe(true);
    expect(touchesComputation('measure', ['metric_type'])).toBe(true);
  });

  it('measure: label/description/unit/format/synonyms are cosmetic', () => {
    expect(touchesComputation('measure', ['measure_label'])).toBe(false);
    expect(touchesComputation('measure', ['unit', 'format_hint', 'synonyms', 'nl_intent'])).toBe(false);
  });

  it('measure: mixed edit with any computation field is computation-relevant', () => {
    expect(touchesComputation('measure', ['measure_label', 'aggregate'])).toBe(true);
  });

  it('dimension: dimension_type is computation-relevant; label/description are not', () => {
    expect(touchesComputation('dimension', ['dimension_type'])).toBe(true);
    expect(touchesComputation('dimension', ['dimension_label', 'description'])).toBe(false);
  });

  it('entity: no editable field is computation-relevant', () => {
    expect(touchesComputation('entity', ['entity_label', 'description', 'synonyms'])).toBe(false);
  });
});

describe('decideEditGate', () => {
  const cosmetic = { touchesComputation: false };
  const computation = { touchesComputation: true };

  it('own draft → free, no demotion', () => {
    const d = decideEditGate({ status: 'draft', isOwnDraft: true, isAdmin: false, canSelfApprove: false, ...computation });
    expect(d.allowed).toBe(true);
    expect(d.forceDemotion).toBe(false);
  });

  it("another user's draft → forbidden", () => {
    const d = decideEditGate({ status: 'draft', isOwnDraft: false, isAdmin: false, canSelfApprove: false, ...cosmetic });
    expect(d.allowed).toBe(false);
  });

  it('candidate + provisional non-admin → blocked', () => {
    const d = decideEditGate({ status: 'candidate', isOwnDraft: false, isAdmin: false, canSelfApprove: false, ...computation });
    expect(d.allowed).toBe(false);
    expect(d.forceDemotion).toBe(false);
  });

  it('candidate + admin → allowed, no demotion', () => {
    const d = decideEditGate({ status: 'candidate', isOwnDraft: false, isAdmin: true, canSelfApprove: false, ...computation });
    expect(d.allowed).toBe(true);
    expect(d.forceDemotion).toBe(false);
  });

  it('candidate + self-approve reputation → allowed', () => {
    const d = decideEditGate({ status: 'candidate', isOwnDraft: false, isAdmin: false, canSelfApprove: true, ...computation });
    expect(d.allowed).toBe(true);
  });

  it('governed + admin + COMPUTATION edit → allowed AND forces demotion', () => {
    const d = decideEditGate({ status: 'governed', isOwnDraft: false, isAdmin: true, canSelfApprove: false, ...computation });
    expect(d.allowed).toBe(true);
    expect(d.forceDemotion).toBe(true);
  });

  it('governed + admin + COSMETIC edit → allowed, stays governed (no demotion)', () => {
    const d = decideEditGate({ status: 'governed', isOwnDraft: false, isAdmin: true, canSelfApprove: false, ...cosmetic });
    expect(d.allowed).toBe(true);
    expect(d.forceDemotion).toBe(false);
  });

  it('governed + provisional non-admin → blocked regardless of field kind', () => {
    expect(decideEditGate({ status: 'governed', isOwnDraft: false, isAdmin: false, canSelfApprove: false, ...cosmetic }).allowed).toBe(false);
    expect(decideEditGate({ status: 'governed', isOwnDraft: false, isAdmin: false, canSelfApprove: false, ...computation }).allowed).toBe(false);
  });

  it('archived → never editable', () => {
    const d = decideEditGate({ status: 'archived', isOwnDraft: false, isAdmin: true, canSelfApprove: true, ...computation });
    expect(d.allowed).toBe(false);
  });
});

describe('shared vocab', () => {
  it('exposes the aggregate + metric-type vocab the compiler expects', () => {
    expect(AGGREGATES).toContain('count_distinct');
    expect(METRIC_TYPES).toEqual(['simple', 'cumulative', 'ratio', 'derived']);
  });
});
