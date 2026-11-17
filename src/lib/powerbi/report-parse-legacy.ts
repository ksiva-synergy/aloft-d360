/**
 * Report definition reader — page count and every measure a visual names.
 * Works on legacy report.json (config is a JSON string) and on PBIR visual JSON.
 */

export type LegacyReportPageSummary = {
  pageCount: number;
  measureRefs: string[];
};

/** Measure names referenced as a visual `Measure` field (any table, not one entity). */
export function extractMeasureNames(text: string): string[] {
  const names = new Set<string>();
  const re = /"Measure"\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const slice = text.slice(match.index, match.index + 800);
    const prop = slice.match(/"Property"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (prop?.[1]) names.add(prop[1].replace(/\\"/g, '"'));
  }
  return [...names];
}

/** Extract measure names referenced in a report definition file. */
export function parseLegacyReportJson(raw: string): LegacyReportPageSummary {
  let measureRefs: string[] = [];
  try {
    const root = JSON.parse(raw) as { config?: string };
    const configStr = typeof root.config === 'string' ? root.config : raw;
    measureRefs = extractMeasureNames(configStr);
    if (!measureRefs.length && configStr !== raw) measureRefs = extractMeasureNames(raw);
  } catch {
    measureRefs = extractMeasureNames(raw);
  }

  const sectionMatches = raw.match(/ReportSection[a-f0-9]+/gi) ?? [];
  const pageCount = new Set(sectionMatches).size;

  return { pageCount, measureRefs };
}
