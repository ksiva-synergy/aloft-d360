import type { JobKind } from '@/lib/context/queue';
import { PBI_LINEAGE_KINDS } from '@/lib/powerbi/launch-scope';
import type { ReportLineageCoverage } from '@/lib/powerbi/report-lineage-coverage';

/** Pick the first pipeline stage that still needs work for all-reports lineage. */
export function inferAllReportsLineageResume(coverage: ReportLineageCoverage): {
  startKind: JobKind;
  chain: JobKind[];
} {
  const kinds = [...PBI_LINEAGE_KINDS] as JobKind[];
  let startIndex = 0;

  if (coverage.reports === 0) {
    startIndex = 0;
  } else if (coverage.definitions < coverage.reports) {
    // Report/model definition harvest still incomplete; job skips already-stored files.
    startIndex = 1;
  } else if (
    coverage.parsed_models < coverage.models
    || coverage.parsed_reports < coverage.definitions
  ) {
    startIndex = 2;
  } else {
    // Re-bind + refresh snapshots for anything not stored yet.
    startIndex = 3;
  }

  const startKind = kinds[startIndex];
  const chain = kinds.slice(startIndex + 1);
  return { startKind, chain };
}

export function resumeStageLabel(kind: JobKind): string {
  switch (kind) {
    case 'pbi_inventory': return 'inventory';
    case 'pbi_definitions': return 'definitions';
    case 'pbi_parse': return 'parse';
    case 'pbi_catalog_link': return 'catalog link';
    default: return kind.replace(/^pbi_/, '').replaceAll('_', ' ');
  }
}