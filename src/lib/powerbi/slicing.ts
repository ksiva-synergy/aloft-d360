/**
 * Sliced parity (Architecture v2, Phase 5): a measure can match Power BI on the grand total while
 * individual members differ (errors cancel out). Compare it per member of a dimension chosen from
 * the model itself: the unique ("one") side of a relationship whose many side the measure reads.
 * Pure.
 */

import type { MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { type ModelGraph, measureNodeId, tableNodeId } from '@/lib/powerbi/model-graph';
import { decideTypedParity } from '@/lib/powerbi/parity-compare';
import { normalizePbiTableName } from '@/lib/powerbi/translate-dax-refs';

export type SliceDimension = { table: string; column: string };

const AUTO_DATE = /^(LocalDateTable_|DateTableTemplate_)/i;
const tkey = (t: string) => normalizePbiTableName(t).toLowerCase();

/**
 * The dimension to slice a measure by: an active relationship whose many side is a table the
 * measure depends on; its one side (unique key) is the slice. Prefers non-calendar dimensions
 * (per entity), skips auto-date tables. Null when the measure reads no related table.
 */
export function chooseSliceDimension(
  measure: string,
  catalog: MeasureLogicCatalog,
  graph: ModelGraph,
): SliceDimension | null {
  const closure = graph.closure(measureNodeId(measure));
  const candidates = (catalog.relationships ?? []).filter(
    (r) =>
      r.active &&
      !AUTO_DATE.test(r.toTable) &&
      closure.has(tableNodeId(r.fromTable)) &&
      catalog.tableMeta.has(tkey(r.toTable)),
  );
  if (!candidates.length) return null;
  const isCalendar = (t: string) => /calendar|date/i.test(t);
  candidates.sort((a, b) => Number(isCalendar(a.toTable)) - Number(isCalendar(b.toTable)) || a.toTable.localeCompare(b.toTable));
  const best = candidates[0]!;
  return { table: catalog.tableMeta.get(tkey(best.toTable))!.displayName, column: best.toColumn };
}

export type SliceComparison = {
  dimension: SliceDimension;
  /** Members where Power BI or SQL has a non-blank value. */
  compared: number;
  matched: number;
  mismatched: number;
  /** Up to 5 differing members (key, Power BI, SQL). */
  examples: { key: string; power_bi: unknown; sql: unknown }[];
  /** The relationship blank member is compared separately (it has no key in SQL). */
  blank_member: { power_bi: unknown } | null;
  /** A side hit the member cap: only members present on both sides were compared. */
  truncated?: boolean;
};

const keyOf = (v: unknown) => (v === null || v === undefined ? null : String(v).trim().toLowerCase());
const blank = (v: unknown) => v === null || v === undefined || v === '';

export function compareSlices(input: {
  dimension: SliceDimension;
  powerBi: { key: unknown; value: unknown }[];
  sql: { key: unknown; value: unknown }[];
  /** Compare only members both sides returned (use when a side was cut at a row cap). */
  onlyCommonKeys?: boolean;
}): SliceComparison {
  const pbi = new Map<string, unknown>();
  let blankMember: unknown = undefined;
  for (const r of input.powerBi) {
    const k = keyOf(r.key);
    if (k === null || k === '') blankMember = r.value;
    else pbi.set(k, r.value);
  }
  const sql = new Map<string, unknown>();
  for (const r of input.sql) {
    const k = keyOf(r.key);
    if (k !== null && k !== '') sql.set(k, r.value);
  }
  const keys = input.onlyCommonKeys
    ? new Set([...pbi.keys()].filter((k) => sql.has(k)))
    : new Set([...pbi.keys(), ...sql.keys()]);
  let compared = 0;
  let matched = 0;
  const examples: SliceComparison['examples'] = [];
  for (const k of keys) {
    const a = pbi.get(k);
    const b = sql.get(k);
    if (blank(a) && blank(b)) continue;
    compared += 1;
    const ok = decideTypedParity({ oracle: { present: true, raw: a ?? null }, sql: { present: true, raw: b ?? null } }).verdict === 'pass';
    if (ok) matched += 1;
    else if (examples.length < 5) examples.push({ key: k, power_bi: a ?? null, sql: b ?? null });
  }
  return {
    dimension: input.dimension,
    compared,
    matched,
    mismatched: compared - matched,
    examples,
    blank_member: blankMember === undefined ? null : { power_bi: blankMember },
    ...(input.onlyCommonKeys ? { truncated: true } : {}),
  };
}
