/**
 * Compact per-table / per-measure facts from the model definition (TMDL metadata stored at
 * parse time in `props.tmdl`) for list views: hidden, description, incremental refresh, field
 * parameter, dynamic format, quick measure, synonyms. Pure.
 */

import { isDisplayHelper } from '@/lib/powerbi/publish-question';
import type { TmdlMeasureMeta, TmdlTableMeta } from '@/lib/powerbi/tmdl-parse';

export type TableDefinitionFlags = {
  hidden?: boolean;
  description?: string;
  /** e.g. "keeps 1 year(s) + refreshes 1 year(s) by INCREMENTAL_REFRESH_DATE" */
  incrementalRefresh?: string;
  fieldParameter?: boolean;
  calculationGroup?: number;
  hierarchies?: number;
};

export type MeasureDefinitionFlags = {
  hidden?: boolean;
  description?: string;
  /** DAX of the dynamic format string. */
  dynamicFormat?: string;
  /** Exists only to show a dynamic label (constant + dynamic format): not published. */
  displayHelper?: boolean;
  quickMeasure?: string;
  synonyms?: string[];
  kpi?: boolean;
};

const tmdl = <T,>(props: unknown) => ((props as { tmdl?: T } | null)?.tmdl ?? null) as T | null;
const compact = <T extends object>(o: T): T | null => (Object.keys(o).length ? o : null);

export function tableDefinitionFlags(props: unknown, sourceM?: string | null): TableDefinitionFlags | null {
  const meta = tmdl<TmdlTableMeta>(props);
  if (!meta) return null;
  const f: TableDefinitionFlags = {};
  if (meta.hidden) f.hidden = true;
  if (meta.description) f.description = meta.description;
  if (meta.fieldParameter) f.fieldParameter = true;
  if (meta.calculationGroup) f.calculationGroup = meta.calculationGroup.items.length;
  if (meta.hierarchies?.length) f.hierarchies = meta.hierarchies.length;
  const rp = meta.refreshPolicy;
  if (rp) {
    const col = (sourceM ?? rp.sourceExpression ?? '').match(/\[([^\]]+)\]\s*>=?\s*RangeStart/)?.[1];
    f.incrementalRefresh =
      `keeps ${rp.rollingWindowPeriods ?? '?'} ${rp.rollingWindowGranularity ?? 'period'}(s) + refreshes ` +
      `${rp.incrementalPeriods ?? '?'} ${rp.incrementalGranularity ?? 'period'}(s)${col ? ` by ${col}` : ''}`;
  }
  return compact(f);
}

export function measureDefinitionFlags(
  measure: { name: string; dax?: string | null; props?: unknown; tableName?: string | null },
  synonymsByKey?: Record<string, string[]>,
): MeasureDefinitionFlags | null {
  const meta = tmdl<TmdlMeasureMeta>(measure.props);
  const f: MeasureDefinitionFlags = {};
  if (meta?.hidden) f.hidden = true;
  if (meta?.description) f.description = meta.description;
  if (meta?.formatStringDefinition) f.dynamicFormat = meta.formatStringDefinition;
  if (isDisplayHelper(measure)) f.displayHelper = true;
  if (meta?.kpi) f.kpi = true;
  const tpl = meta?.extendedProperties?.MeasureTemplate;
  if (tpl) {
    try {
      f.quickMeasure = (JSON.parse(tpl) as { daxTemplateName?: string }).daxTemplateName ?? 'quick measure';
    } catch {
      f.quickMeasure = 'quick measure';
    }
  }
  const syn = synonymsByKey?.[`${measure.tableName ?? ''}.${measure.name}`.toLowerCase()]?.filter(
    (s) => s.toLowerCase() !== measure.name.toLowerCase(),
  );
  if (syn?.length) f.synonyms = syn;
  return compact(f);
}

/** Model synonyms (`props.synonyms.entries`) keyed by lower-case `Table.Object`. */
export function synonymIndex(modelProps: unknown): Record<string, string[]> {
  const entries = (modelProps as { synonyms?: { entries?: Record<string, string[]> } } | null)?.synonyms?.entries ?? {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(entries)) out[k.toLowerCase()] = v;
  return out;
}
