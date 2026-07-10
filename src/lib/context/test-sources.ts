/**
 * Gate / scratch sources created by verify-ch*.ts scripts.
 * Production estate sources (e.g. verify-estate-1) are NOT test sources.
 */
export function isTestSourceDisplayName(displayName: string | null | undefined): boolean {
  if (!displayName) return false;
  const lower = displayName.toLowerCase();
  if (lower.includes('test')) return true;
  if (lower.includes('-dev')) return true;
  if (lower.includes('-staging')) return true;
  if (/ch\d+ verify/i.test(displayName)) return true;
  return false;
}

/** SQL predicate on platform_context_sources.display_name (no leading AND). */
export const TEST_SOURCE_DISPLAY_NAME_SQL = `
  display_name ILIKE '%test%'
  OR display_name ILIKE '%-dev%'
  OR display_name ILIKE '%-staging%'
  OR display_name ~* 'CH[0-9]+ verify'
`;
