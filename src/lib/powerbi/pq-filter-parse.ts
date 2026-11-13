/** Power Query row-filter predicates from partition `source_m` (M code), comments stripped. */

import { extractMRowFilterTexts } from '@/lib/powerbi/m-lineage';

export function extractPqRowFilters(sourceM: string | null | undefined): string[] {
  return extractMRowFilterTexts(sourceM);
}

export function sourceMentionsRowFilter(sourceM: string | null | undefined): boolean {
  return extractPqRowFilters(sourceM).length > 0;
}
