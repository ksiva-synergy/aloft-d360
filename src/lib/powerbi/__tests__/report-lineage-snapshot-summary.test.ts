import { describe, expect, it } from 'vitest';
import { isLineageQuestion, matchesQuestion, summarizeEstate, summarizeSnapshot } from '@/lib/powerbi/report-lineage-snapshot-summary';

const snap = (status: string, tables: unknown) => summarizeSnapshot({ status, generated_at: new Date('2026-11-16T10:00:00Z'), warning_count: 2n, tables });

describe('snapshot summaries', () => {
  it('counts tables by origin class and Unity Catalog coverage', () => {
    const summary = snap('partial', [
      { systems: ['databricks'], kind: 'warehouse_query', uc: true },
      { systems: ['snowflake'], kind: 'warehouse_query', uc: false },
      { systems: ['unknown', 'sharepoint'], kind: 'other_file', uc: false },
      { systems: ['unknown'], kind: 'unknown', uc: false },
      { systems: [], kind: null, uc: false },
    ]);
    expect(summary).toMatchObject({
      tables: 5, uc_bound: 1, uc_candidates: 2, warning_count: 2, generated_at: '2026-11-16T10:00:00.000Z',
      mix: { warehouse: 1, database: 1, file: 1, model: 0, unknown: 2 },
    });
    expect(matchesQuestion(summary, 'file')).toBe(true);
    expect(matchesQuestion(summary, 'unbound')).toBe(true);
    expect(matchesQuestion(summary, 'unknown')).toBe(true);
    expect(matchesQuestion(summary, 'blocked')).toBe(false);
  });

  it('tolerates snapshots without source facts', () => {
    const summary = snap('blocked', null);
    expect(summary.tables).toBe(0);
    expect(matchesQuestion(summary, 'blocked')).toBe(true);
    expect(matchesQuestion(summary, 'unbound')).toBe(false);
  });

  it('totals the estate and validates question ids', () => {
    const estate = summarizeEstate([
      snap('ready', [{ systems: ['databricks'], kind: 'warehouse_query', uc: true }]),
      snap('failed', [{ systems: ['web'], kind: 'other_file', uc: false }]),
    ]);
    expect(estate.classes).toEqual({ warehouse: 1, database: 0, file: 1, model: 0, unknown: 0 });
    expect(estate.questions).toEqual({ file: 1, unbound: 0, unknown: 0, blocked: 1 });
    expect(isLineageQuestion('file')).toBe(true);
    expect(isLineageQuestion('drop table')).toBe(false);
  });
});
