import { describe, expect, it } from 'vitest';

import { extractPqRowFilters } from '@/lib/powerbi/pq-filter-parse';
import {
  analyzeMeasureLogic,
  type MeasureLogicCatalog,
} from '@/lib/powerbi/measure-logic-analyze';

function catalog(partial: {
  cols: Record<string, Record<string, { source_column?: string; calculated_dax?: string }>>;
  tables?: Record<string, { uc?: string; source_m?: string }>;
}): MeasureLogicCatalog {
  const columnsByTable = new Map<string, Map<string, { source_column: string | null; calculated_dax: string | null }>>();
  for (const [table, cols] of Object.entries(partial.cols)) {
    const m = new Map<string, { source_column: string | null; calculated_dax: string | null }>();
    for (const [col, meta] of Object.entries(cols)) {
      const row = {
        source_column: meta.source_column ?? null,
        calculated_dax: meta.calculated_dax ?? null,
      };
      m.set(col, row);
      m.set(col.toLowerCase(), row);
    }
    columnsByTable.set(table.toLowerCase(), m);
  }
  const tableMeta = new Map<
    string,
    { displayName: string; uc_full_path: string | null; source_m: string | null }
  >();
  for (const [table, meta] of Object.entries(partial.tables ?? {})) {
    tableMeta.set(table.toLowerCase(), {
      displayName: table,
      uc_full_path: meta.uc ?? null,
      source_m: meta.source_m ?? null,
    });
  }
  return { columnsByTable, tableMeta };
}

describe('extractPqRowFilters', () => {
  it('pulls SelectRows predicates', () => {
    const m = `#"Filtered Rows2" = Table.SelectRows(#"Changed Type3", each [NO_OF_FINDINGS] > 10)`;
    expect(extractPqRowFilters(m)).toContain('[NO_OF_FINDINGS] > 10');
  });
});

describe('analyzeMeasureLogic', () => {
  it('blocks SIRE_Fin-style calc reference', () => {
    const cat = catalog({
      cols: {
        'Vessel Internal Audit': {
          SIRE_Check: {
            calculated_dax: `VAR x = MAX('SIRE 2_0'[KeyConcatenate]) RETURN x`,
          },
          imono: { source_column: 'imono' },
        },
        'SIRE 2_0': {
          KeyConcatenate: {
            calculated_dax: "TRIM('SIRE 2_0'[IMO_NO] & \"-\" & FORMAT('SIRE 2_0'[DATE], \"YYYYMMDD\"))",
          },
          IMO_NO: { source_column: 'IMO_NO' },
          DATE: { source_column: 'DATE' },
        },
      },
      tables: {
        'Vessel Internal Audit': {
          uc: 'reporting_layer.qhse.bi_vw_internalaudit',
          source_m: `each ([status] <> "Rejected")`,
        },
        'SIRE 2_0': {
          uc: 'reporting_layer.qhse.bi_synergypool_vw_sire_2_0',
          source_m: `each [NO_OF_FINDINGS] > 10`,
        },
      },
    });

    const a = analyzeMeasureLogic({
      dax: "DISTINCTCOUNTNOBLANK('Vessel Internal Audit'[SIRE_Check])",
      catalog: cat,
      hasUc: true,
    });

    expect(a.block_automated_sql).toBe(true);
    expect(a.reproduction_strategy).toBe('multi_table_expand');
    expect(a.measure_refs[0]?.kind).toBe('calculated');
    expect(a.tables_involved.length).toBeGreaterThanOrEqual(2);
  });

  it('flags harvest gap when column missing from pbi_columns on bound table', () => {
    const cat = catalog({
      cols: {
        'Vessel Internal Audit': {
          SIRE_Check: { calculated_dax: 'RETURN 1' },
        },
      },
      tables: {
        'Vessel Internal Audit': { uc: 'reporting_layer.qhse.bi_vw_internalaudit' },
      },
    });
    const a = analyzeMeasureLogic({
      dax: "DISTINCTCOUNTNOBLANK('Vessel Internal Audit'[PSC_Check_Det])",
      catalog: cat,
      hasUc: true,
    });
    expect(a.reproduction_strategy).toBe('reparse_required');
    expect(a.harvest_gap_refs).toContain('Vessel Internal Audit[PSC_Check_Det]');
    expect(a.block_reason).toMatch(/Harvest gap/i);
  });

  it('allows simple warehouse count', () => {
    const cat = catalog({
      cols: {
        'Vessel Internal Audit': {
          ReferenceNo: { source_column: 'ReferenceNo' },
        },
      },
      tables: {
        'Vessel Internal Audit': { uc: 'reporting_layer.qhse.bi_vw_internalaudit' },
      },
    });

    const a = analyzeMeasureLogic({
      dax: "COUNT('Vessel Internal Audit'[ReferenceNo])",
      catalog: cat,
      hasUc: true,
    });

    expect(a.block_automated_sql).toBe(false);
    expect(a.reproduction_strategy).toBe('rule');
    expect(a.complexity_class).toBe('scalar_physical');
  });
});
