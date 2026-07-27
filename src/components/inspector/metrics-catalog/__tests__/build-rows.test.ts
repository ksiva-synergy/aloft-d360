/**
 * buildRows — the review + my-drafts flatten. The load-bearing detail: draft
 * rows carry no full_path of their own (it lives only on platform_sem_entities),
 * so they MUST join to their parent entity's path via entityId, and drafts must
 * be scoped to the active model.
 */
import { describe, it, expect } from 'vitest';
import { buildRows, type ReviewResponse, type MyDraftsResponse } from '../use-catalog-data';

const review: ReviewResponse = {
  model: { id: 'model1', name: 'M', status: 'governed' },
  entities: [
    {
      id: 'ent1',
      entity_label: 'Deficiency',
      full_path: 'curated_db.deffect_list.deficiency',
      status: 'governed',
      synonyms: ['defect list'],
      created_by: null,
      updated_at: '2026-07-01T00:00:00Z',
      dimensions: [
        { id: 'd1', column_name: 'flag', dimension_label: 'Flag state', dimension_type: 'categorical', status: 'candidate', created_by: 'u1' },
      ],
      measures: [
        { id: 'm1', column_name: 'cnt', measure_label: 'Deficiency count', aggregate: 'count', metric_type: 'simple', status: 'candidate', created_by: null },
      ],
      joins: [{}, {}],
    },
  ],
};

describe('buildRows', () => {
  it('flattens entity + dims + measures with propagated full_path and D/M/J', () => {
    const rows = buildRows(review, null, 'model1', 'me');
    const entity = rows.find((r) => r.kind === 'entity')!;
    expect(entity.dCount).toBe(1);
    expect(entity.mCount).toBe(1);
    expect(entity.jCount).toBe(2);

    const dim = rows.find((r) => r.kind === 'dimension')!;
    expect(dim.fullPath).toBe('curated_db.deffect_list.deficiency'); // from parent entity
    expect(dim.column).toBe('flag');
    expect(dim.createdBy).toBe('u1');

    const meas = rows.find((r) => r.kind === 'measure')!;
    expect(meas.status).toBe('candidate');
  });

  it('joins draft rows to their parent entity full_path via entityId', () => {
    const drafts: MyDraftsResponse = {
      entities: [
        {
          modelId: 'model1',
          entityId: 'ent1', // matches a review entity → inherits its full_path
          entityLabel: 'Deficiency',
          dimensions: [],
          measures: [{ id: 'draftM', column_name: 'sev', measure_label: 'Severity index', aggregate: 'avg', metric_type: 'simple', status: 'draft' }],
        },
      ],
    };
    const rows = buildRows(review, drafts, 'model1', 'me');
    const draftRow = rows.find((r) => r.id === 'draftM')!;
    expect(draftRow.isDraft).toBe(true);
    expect(draftRow.status).toBe('draft');
    expect(draftRow.fullPath).toBe('curated_db.deffect_list.deficiency'); // joined, not blank
    expect(draftRow.createdBy).toBe('me'); // my-drafts is owner-scoped
  });

  it('scopes drafts to the active model', () => {
    const drafts: MyDraftsResponse = {
      entities: [
        { modelId: 'OTHER', entityId: 'entX', entityLabel: 'X', dimensions: [], measures: [{ id: 'skip', measure_label: 'Skip', status: 'draft' }] },
      ],
    };
    const rows = buildRows(review, drafts, 'model1', 'me');
    expect(rows.find((r) => r.id === 'skip')).toBeUndefined();
  });

  it('falls back to entity label when the draft entity is not in review', () => {
    const drafts: MyDraftsResponse = {
      entities: [
        { modelId: 'model1', entityId: 'draftEnt', entityLabel: 'Draft-only entity', dimensions: [{ id: 'dd', column_name: 'c', dimension_label: 'DD', status: 'draft' }], measures: [] },
      ],
    };
    const rows = buildRows(review, drafts, 'model1', 'me');
    const dd = rows.find((r) => r.id === 'dd')!;
    expect(dd.fullPath).toBe('Draft-only entity');
  });
});
