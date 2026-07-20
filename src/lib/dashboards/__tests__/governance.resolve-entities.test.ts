import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * resolveDeferredEntityIds is the server-side entity binding that makes a
 * guided-authored widget (which defers `semanticQuery.entityId = ''` because the
 * client has no catalog) INDISTINGUISHABLE AT REST from a manually authored one
 * (which got its entityId from the picker). Without it, the compiler throws on
 * the empty entityId and a guided dashboard is broken the moment it's rendered.
 */

const { measuresFindMany, dimensionsFindMany } = vi.hoisted(() => ({
  measuresFindMany: vi.fn(),
  dimensionsFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: {
    platform_sem_measures: { findMany: measuresFindMany },
    platform_sem_dimensions: { findMany: dimensionsFindMany },
  },
}));

import { resolveDeferredEntityIds } from '../governance';
import type { WidgetSpec } from '../types';

const ORG_ID = 'org-1';

function semantic(entityId: string, measureIds: string[], dimensionIds: string[] = []): WidgetSpec {
  return {
    widgetId: `w-${entityId || 'deferred'}-${measureIds.join('_')}`,
    title: 't',
    chartKind: 'bar',
    chartConfig: {},
    position: { col: 0, row: 0, w: 6, h: 4 },
    measureSnapshots: [],
    semanticQuery: {
      modelId: 'model-1',
      entityId,
      dimensions: dimensionIds.map((dimensionId) => ({ dimensionId })),
      measures: measureIds.map((measureId) => ({ measureId })),
      filters: [],
      sorts: [],
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resolveDeferredEntityIds', () => {
  it('binds a deferred widget to the entity that owns its FIRST measure', async () => {
    measuresFindMany.mockResolvedValue([{ id: 'm-1', entity_id: 'entity-A' }]);
    dimensionsFindMany.mockResolvedValue([]);

    const [out] = await resolveDeferredEntityIds([semantic('', ['m-1'])], ORG_ID);
    expect((out as any).semanticQuery.entityId).toBe('entity-A');
  });

  it('falls back to the first DIMENSION\'s entity when the widget has no measures', async () => {
    measuresFindMany.mockResolvedValue([]);
    dimensionsFindMany.mockResolvedValue([{ id: 'd-1', entity_id: 'entity-B' }]);

    const [out] = await resolveDeferredEntityIds([semantic('', [], ['d-1'])], ORG_ID);
    expect((out as any).semanticQuery.entityId).toBe('entity-B');
  });

  it('leaves a widget that ALREADY has an entityId untouched (manual path — no query, no rebind)', async () => {
    const widgets = [semantic('entity-manual', ['m-1'])];
    const [out] = await resolveDeferredEntityIds(widgets, ORG_ID);
    expect((out as any).semanticQuery.entityId).toBe('entity-manual');
    // Nothing to resolve → no DB round-trip.
    expect(measuresFindMany).not.toHaveBeenCalled();
    expect(dimensionsFindMany).not.toHaveBeenCalled();
  });

  it('returns the array unchanged (same values) when nothing is deferred', async () => {
    const widgets = [semantic('e1', ['m-1']), semantic('e2', ['m-2'])];
    const out = await resolveDeferredEntityIds(widgets, ORG_ID);
    expect(out).toEqual(widgets);
  });

  it('leaves a raw-SQL widget alone (no semanticQuery to bind)', async () => {
    const raw: WidgetSpec = {
      widgetId: 'w-raw', title: 'r', chartKind: 'bar', chartConfig: {},
      position: { col: 0, row: 0, w: 6, h: 4 },
      chartSource: 'raw_sql', rawSql: 'SELECT 1', resultSchema: [], connectionId: 'c',
    };
    const [out] = await resolveDeferredEntityIds([raw], ORG_ID);
    expect(out).toEqual(raw);
    expect(measuresFindMany).not.toHaveBeenCalled();
  });

  it('leaves a deferred widget with NO resolvable field unchanged (validateWidgetReferences rejects it downstream)', async () => {
    measuresFindMany.mockResolvedValue([]); // referenced id not found
    dimensionsFindMany.mockResolvedValue([]);
    const [out] = await resolveDeferredEntityIds([semantic('', ['ghost'])], ORG_ID);
    expect((out as any).semanticQuery.entityId).toBe('');
  });
});
