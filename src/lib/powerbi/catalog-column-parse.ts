/** Pure helpers for PBI ↔ catalog column matching (testable without server-only). */

export function normalizeColumnKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Backtick / bare identifiers likely present in native SQL SELECT lists. */
export function extractColumnNamesFromNativeSql(sql: string | null | undefined): string[] {
  if (!sql?.trim()) return [];
  const text = sql.replace(/#\(lf\)/gi, '\n');
  const names = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const n = m[1].trim();
    if (n) names.add(n);
  }
  const selectMatch = text.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
  if (selectMatch) {
    const segment = selectMatch[1];
    for (const m of segment.matchAll(/\b([A-Za-z_][\w]*)\b/g)) {
      const w = m[1];
      if (!/^(SELECT|DISTINCT|AS|CASE|WHEN|THEN|ELSE|END|CAST|FROM)$/i.test(w)) {
        names.add(w);
      }
    }
  }
  return [...names];
}

export function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(normalizeColumnKey(a).split('_').filter(Boolean));
  const tb = new Set(normalizeColumnKey(b).split('_').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap / Math.max(ta.size, tb.size);
}
