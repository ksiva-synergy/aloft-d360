import {
  compileMeasureToSql,
  type DaxCompileOptions,
} from '@/lib/powerbi/dax-sql-compile';
import type {
  MeasureLogicAnalysis,
  MeasureLogicCatalog,
} from '@/lib/powerbi/measure-logic-analyze';

export type MeasureSqlExpandResult = {
  sql: string;
  pattern: string;
  expand_spec: Record<string, unknown>;
};

export type MeasureSqlExpandOutcome =
  | ({ ok: true } & MeasureSqlExpandResult)
  | { ok: false; reason: string; notes: string[] };

/**
 * Expand a measure blocked by the logic gate (calc columns / multi-table / PQ filters)
 * by compiling its DAX against the harvested model (see dax-sql-compile.ts).
 */
export function expandMeasureSql(input: {
  measureDax: string;
  measureLogic: MeasureLogicAnalysis;
  catalog: MeasureLogicCatalog;
  options?: DaxCompileOptions;
  /** Compile regardless of the analyzer's reproduction strategy (compile-first translate). */
  anyStrategy?: boolean;
}): MeasureSqlExpandOutcome {
  const strategy = input.measureLogic.reproduction_strategy;
  if (!input.anyStrategy && strategy !== 'multi_table_expand' && strategy !== 'calc_expand') {
    return {
      ok: false,
      reason: `reproduction_strategy=${strategy} is not an expand strategy`,
      notes: [],
    };
  }
  const out = compileMeasureToSql({
    measureDax: input.measureDax,
    catalog: input.catalog,
    options: input.options,
  });
  if (!out.ok) return out;
  return {
    ok: true,
    sql: out.sql,
    pattern: 'dax_compile',
    expand_spec: {
      tables: out.tables,
      calc_columns: out.calc_columns,
      measures_inlined: out.measures_inlined,
      notes: out.notes,
      warnings: out.warnings,
      result_kind: out.result_kind,
      source_aliases: out.source_aliases,
      options: input.options ?? {},
    },
  };
}

export function tryExpandMeasureSql(input: {
  measureDax: string;
  measureLogic: MeasureLogicAnalysis;
  catalog: MeasureLogicCatalog;
}): MeasureSqlExpandResult | null {
  const out = expandMeasureSql(input);
  return out.ok ? { sql: out.sql, pattern: out.pattern, expand_spec: out.expand_spec } : null;
}
