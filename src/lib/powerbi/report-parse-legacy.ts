/**
 * Minimal legacy report.json reader — page + measure references (build plan §8.6).
 */

export type LegacyReportPageSummary = {
  pageCount: number;
  measureRefs: string[];
};

/** Extract measure names referenced in serialized report config. */
export function parseLegacyReportJson(raw: string): LegacyReportPageSummary {
  let measureRefs: string[] = [];
  try {
    const root = JSON.parse(raw) as { config?: string };
    const configStr = root.config ?? raw;
    const measureMatches = configStr.matchAll(
      /"Property"\s*:\s*"([^"]+)"[^}]*"Entity"\s*:\s*"CII_Measures"/g,
    );
    for (const m of measureMatches) {
      if (m[1]) measureRefs.push(m[1]);
    }
    const alt = configStr.matchAll(
      /"Entity"\s*:\s*"CII_Measures"[\s\S]*?"Property"\s*:\s*"([^"]+)"/g,
    );
    for (const m of alt) {
      if (m[1]) measureRefs.push(m[1]);
    }
    measureRefs = [...new Set(measureRefs)];
  } catch {
    measureRefs = [];
  }

  const sectionMatches = raw.match(/ReportSection[a-f0-9]+/gi) ?? [];
  const pageCount = new Set(sectionMatches).size;

  return { pageCount, measureRefs };
}
