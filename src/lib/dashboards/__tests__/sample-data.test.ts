/**
 * sample-data.ts — determinism seeded off MEASURE IDENTITY (not the card).
 *
 * The visual half of the "same metric = same colour/shape everywhere" invariant:
 * a measure's sample series must be identical regardless of card position,
 * surrounding measures, or dimension context. (Colour is asserted separately via
 * colorForMeasure; this covers the shape.)
 */
import { describe, it, expect } from 'vitest';
import { buildSampleData } from '@/lib/dashboards/sample-data';

describe('buildSampleData', () => {
  it('is deterministic — identical input yields identical output', () => {
    const input = {
      chartKind: 'bar' as const,
      measureLabels: ['Total Incidents'],
      dimensionLabels: ['Vessel Type'],
      measureIds: ['mid_incidents'],
    };
    expect(buildSampleData(input)).toEqual(buildSampleData(input));
  });

  it('seeds a measure off its identity, independent of card context', () => {
    // Same measure identity, DIFFERENT surrounding card (extra measure, different
    // dimension, different order) → its series data must match point-for-point.
    const a = buildSampleData({
      chartKind: 'bar',
      measureLabels: ['Total Incidents'],
      dimensionLabels: ['Vessel Type'],
      measureIds: ['mid_incidents'],
    });
    const b = buildSampleData({
      chartKind: 'bar',
      measureLabels: ['Avg Days', 'Total Incidents'],
      dimensionLabels: ['Region'],
      measureIds: ['mid_days', 'mid_incidents'],
    });
    const aIncidents = a.series.find((s) => s.measureId === 'mid_incidents')!;
    const bIncidents = b.series.find((s) => s.measureId === 'mid_incidents')!;
    expect(bIncidents.data).toEqual(aIncidents.data);
  });

  it('falls back to the label as identity when no id is given', () => {
    const byLabel = buildSampleData({ chartKind: 'bar', measureLabels: ['Revenue'], dimensionLabels: ['Month'] });
    const byId = buildSampleData({ chartKind: 'bar', measureLabels: ['Revenue'], dimensionLabels: ['Month'], measureIds: ['Revenue'] });
    expect(byLabel.series[0].data).toEqual(byId.series[0].data);
  });

  it('generates a non-empty, correctly-shaped result (bar)', () => {
    const r = buildSampleData({ chartKind: 'bar', measureLabels: ['Revenue'], dimensionLabels: ['Month'] });
    expect(r.isEmpty).toBe(false);
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.series[0].data.length).toBe(r.categories.length);
    expect(r.series[0].data.every((v) => typeof v === 'number')).toBe(true);
  });

  it('KPI has a single value and no categories', () => {
    const r = buildSampleData({ chartKind: 'kpi', measureLabels: ['Total'], dimensionLabels: [] });
    expect(r.categories).toEqual([]);
    expect(r.series[0].data.length).toBe(1);
  });
});
