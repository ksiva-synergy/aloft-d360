import { pathCovers } from '@/lib/access/explain';

export interface WelcomeDepartmentDef {
  key: string;
  name: string;
  paths: string[];
}

/** Prefer this order on the welcome screen when multiple domains have data. */
export const DOMAIN_DISPLAY_ORDER = ['crewing', 'marine', 'technical', 'qhse', 'finance', 'hr', 'explore'] as const;

const DISPLAY: Record<string, string> = {
  crewing: 'Crewing',
  marine: 'Marine',
  technical: 'Technical',
  qhse: 'QHSE',
  finance: 'Finance',
  hr: 'HR',
  explore: 'More to explore',
};

export function displayDepartmentName(key: string, configuredName?: string): string {
  if (DISPLAY[key]) return DISPLAY[key];
  const fromConfig = configuredName?.trim();
  if (fromConfig) {
    return fromConfig
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** When a table is not on a department path, infer domain from schema / path tokens. */
const PATH_HINTS: { key: string; patterns: RegExp[] }[] = [
  { key: 'finance', patterns: [/\.finance\b/, /finance/, /ebitda/, /account/] },
  { key: 'qhse', patterns: [/\.qhse\b/, /\bqhse\b/, /safety/, /incident/, /inspection/] },
  { key: 'crewing', patterns: [/crewing/, /\bcrew\b/, /seafarer/, /portage_bill/, /masters_crewing/] },
  { key: 'marine', patterns: [/voyage/, /vessel/, /sp_vessel/, /navtor/, /competitor/, /addressable_market/] },
  { key: 'technical', patterns: [/pms/, /defect/, /deffect/, /\btechnical\b/] },
  { key: 'hr', patterns: [/darwin/, /\.hr\b/] },
];

/**
 * Resolve one harvested object to a business domain key.
 * Registered department paths win; otherwise path heuristics; else `explore`.
 */
export function resolveObjectDepartmentKey(fullPath: string, departments: WelcomeDepartmentDef[]): string {
  const path = fullPath.trim().toLowerCase();
  let best: { key: string; depth: number } | null = null;

  for (const dept of departments) {
    for (const grant of dept.paths) {
      if (!pathCovers(grant, path)) continue;
      const depth = grant.split('.').filter(Boolean).length;
      if (!best || depth > best.depth) best = { key: dept.key, depth };
    }
  }
  if (best) return best.key;

  for (const hint of PATH_HINTS) {
    if (hint.patterns.some((re) => re.test(path))) return hint.key;
  }
  return 'explore';
}

export function sortDepartmentKeys(keys: string[]): string[] {
  const rank = (k: string) => {
    const i = DOMAIN_DISPLAY_ORDER.indexOf(k as (typeof DOMAIN_DISPLAY_ORDER)[number]);
    return i >= 0 ? i : DOMAIN_DISPLAY_ORDER.length;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
