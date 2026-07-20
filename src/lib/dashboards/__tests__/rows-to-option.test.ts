import { describe, it, expect } from 'vitest';
import { rowsToOption } from '../rows-to-option';
import { toAlias } from '@/lib/semantic/compiler';

/**
 * DATA-3 mapper guard (issue #2, Task 5). The bug this file exists to catch:
 * reading result rows by the human LABEL instead of `toAlias(label)` yields
 * correct axes with all-`undefined` series — visually identical to the old
 * "PREVIEW — NO DATA" placeholder. A false green.
 */
describe('rowsToOption — alias keying (the false-green guard)', () => {
  const dimensions = [{ dimensionId: 'd1', label: 'Root cause category' }];
  const measures = [{ measureId: 'm1', label: 'Total Revenue', unit: 'USD', format: 'currency' }];

  // Rows are keyed by the COMPILER alias, exactly as executeSemanticQuery returns them.
  const rows = [
    { [toAlias('Root cause category')]: 'Fatigue', [toAlias('Total Revenue')]: 120 },
    { [toAlias('Root cause category')]: 'Weather', [toAlias('Total Revenue')]: 80 },
  ];

  it('keys series off toAlias(label), producing a non-empty series', () => {
    const out = rowsToOption({ chartKind: 'bar', dimensions, measures, rows });

    expect(out.isEmpty).toBe(false);
    expect(out.series).toHaveLength(1);
    expect(out.series[0].alias).toBe('total_revenue');
    // The data is real — pulled via the alias, not the label.
    expect(out.series[0].data).toEqual([120, 80]);
    expect(out.categories).toEqual(['Fatigue', 'Weather']);
    expect(out.dimAliases).toEqual(['root_cause_category']);
  });

  it('demonstrates the gotcha: reading by raw label would be all-undefined', () => {
    // If the mapper had used row[measure.label] instead of row[alias]:
    const naive = rows.map((r) => r['Total Revenue' as keyof typeof r]);
    expect(naive).toEqual([undefined, undefined]);

    // The real mapper does NOT fall into this — it reads by alias.
    const out = rowsToOption({ chartKind: 'bar', dimensions, measures, rows });
    expect(out.series[0].data.some((v) => v !== undefined && v !== null)).toBe(true);
  });

  it('carries measure unit/format as metadata (Task 6), not baked into an option', () => {
    const out = rowsToOption({ chartKind: 'bar', dimensions, measures, rows });
    expect(out.series[0].unit).toBe('USD');
    expect(out.series[0].format).toBe('currency');
  });

  it('defaults unit/format to null when the measure has none', () => {
    const out = rowsToOption({
      chartKind: 'bar',
      dimensions,
      measures: [{ measureId: 'm1', label: 'Total Revenue' }],
      rows,
    });
    expect(out.series[0].unit).toBeNull();
    expect(out.series[0].format).toBeNull();
  });
});

describe('rowsToOption — empty is distinguishable from populated', () => {
  const dimensions = [{ dimensionId: 'd1', label: 'Root cause category' }];
  const measures = [{ measureId: 'm1', label: 'Total Revenue' }];

  it('a zero-row result is isEmpty:true with resolved-but-empty series', () => {
    const out = rowsToOption({ chartKind: 'bar', dimensions, measures, rows: [] });

    expect(out.isEmpty).toBe(true);
    expect(out.categories).toEqual([]);
    // Series are still RESOLVED (alias present) so the shell knows the shape —
    // just carrying no data. This is what lets the shell render an empty branch
    // rather than a silently-blank chart.
    expect(out.series).toHaveLength(1);
    expect(out.series[0].alias).toBe('total_revenue');
    expect(out.series[0].data).toEqual([]);
  });

  it('empty and populated outputs differ in isEmpty and series data', () => {
    const empty = rowsToOption({ chartKind: 'bar', dimensions, measures, rows: [] });
    const populated = rowsToOption({
      chartKind: 'bar',
      dimensions,
      measures,
      rows: [{ root_cause_category: 'Fatigue', total_revenue: 5 }],
    });

    expect(empty.isEmpty).toBe(true);
    expect(populated.isEmpty).toBe(false);
    expect(empty.series[0].data).toEqual([]);
    expect(populated.series[0].data).toEqual([5]);
  });
});
