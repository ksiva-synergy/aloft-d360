/**
 * Measure names referenced in harvested Power BI report definitions (PBIR or legacy).
 * Shared by model graph (report consumers) and report lineage API.
 */

import fs from 'node:fs';
import path from 'node:path';

import { extractMeasureNames, parseLegacyReportJson } from '@/lib/powerbi/report-parse-legacy';

function getPbiRawStoreRoot(): string {
  const fromEnv = process.env.PBI_RAW_STORE_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'powerbi-estate');
}

export const MAX_REPORT_JSON_FILES = 80;
export const MAX_REPORT_JSON_BYTES = 1_500_000;

export function storedMeasureRefs(props: unknown): string[] {
  if (!props || typeof props !== 'object') return [];
  const parse = (props as Record<string, unknown>).parse;
  if (!parse || typeof parse !== 'object') return [];
  const refs = (parse as Record<string, unknown>).measure_refs;
  return Array.isArray(refs) ? refs.filter((x): x is string => typeof x === 'string') : [];
}

export function storedReportPageCount(props: unknown): number | null {
  if (!props || typeof props !== 'object') return null;
  const parse = (props as Record<string, unknown>).parse;
  if (!parse || typeof parse !== 'object') return null;
  const n = (parse as Record<string, unknown>).page_count;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function reportDefinitionDir(props: unknown, root: string = getPbiRawStoreRoot()): string | null {
  if (!props || typeof props !== 'object') return null;
  const def = (props as Record<string, unknown>).definition;
  if (!def || typeof def !== 'object') return null;
  const storage = (def as Record<string, unknown>).storage_path;
  if (typeof storage !== 'string' || !storage) return null;
  return path.join(root, storage);
}

/** Measure names in a harvested report folder (legacy report.json or PBIR visual JSON). */
export function measureRefsOnDisk(dir: string): string[] {
  return walkReportJson(dir, new Set());
}

function walkReportJson(dir: string, names: Set<string>): string[] {
  const stack = [dir];
  let files = 0;
  while (stack.length && files < MAX_REPORT_JSON_FILES) {
    const cur = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      if (files >= MAX_REPORT_JSON_FILES) break;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.name.endsWith('.json')) {
        files += 1;
        try {
          if (fs.statSync(full).size > MAX_REPORT_JSON_BYTES) continue;
          for (const n of extractMeasureNames(fs.readFileSync(full, 'utf8'))) names.add(n);
        } catch {
          /* skip unreadable file */
        }
      }
    }
  }
  return [...names];
}

export type ReportMeasureRefSources = {
  measures: string[];
  from_props: string[];
  from_disk: string[];
  has_definition_on_disk: boolean;
  page_count: number | null;
};

/** Union measure names from Postgres parse props and on-disk report JSON. */
export function collectReportMeasureRefs(props: unknown, root: string = getPbiRawStoreRoot()): ReportMeasureRefSources {
  const fromProps = storedMeasureRefs(props);
  const dir = reportDefinitionDir(props, root);
  const fromDisk = dir && fs.existsSync(dir) ? measureRefsOnDisk(dir) : [];
  const measures = [...new Set([...fromProps, ...fromDisk])].sort((a, b) => a.localeCompare(b));
  return {
    measures,
    from_props: fromProps,
    from_disk: fromDisk,
    has_definition_on_disk: Boolean(dir && fs.existsSync(dir)),
    page_count: storedReportPageCount(props),
  };
}

export type ReportConsumer = { id: string; name: string; measures: string[] };

export function reportConsumerFromRow(row: {
  id: string;
  name: string;
  props: unknown;
}): ReportConsumer {
  const { measures } = collectReportMeasureRefs(row.props);
  return { id: row.id, name: row.name, measures };
}

/** PBIR page folders under `definition/pages/`, else legacy `report.json` section count. */
export function countReportPagesInDir(absDir: string): number {
  const pagesDir = path.join(absDir, 'definition', 'pages');
  if (fs.existsSync(pagesDir)) {
    try {
      const n = fs.readdirSync(pagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
      if (n > 0) return n;
    } catch {
      /* fall through */
    }
  }
  const reportJson = path.join(absDir, 'report.json');
  if (fs.existsSync(reportJson)) {
    try {
      return parseLegacyReportJson(fs.readFileSync(reportJson, 'utf8')).pageCount;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Summarize any harvested report folder (PBIR tree or legacy report.json). */
export function summarizeReportDefinitionDir(absDir: string): { pageCount: number; measureRefs: string[] } {
  const reportJson = path.join(absDir, 'report.json');
  const hasPbirPages = fs.existsSync(path.join(absDir, 'definition', 'pages'));
  if (fs.existsSync(reportJson) && !hasPbirPages) {
    return parseLegacyReportJson(fs.readFileSync(reportJson, 'utf8'));
  }
  const measureRefs = measureRefsOnDisk(absDir);
  return { pageCount: countReportPagesInDir(absDir), measureRefs };
}