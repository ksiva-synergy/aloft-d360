/**
 * Section dependencies: a screen that embeds a feature owned by another section. Pure module, safe
 * on client and server.
 *
 * Each entry lists the exact API calls the host screen makes into the other section. A caller who
 * has the host section (at the level given per call) may make those calls without having the other
 * section, so the embedded feature works. Per-item rules still apply inside the API (their own
 * connections and ones shared with them; knowledge bases they may see).
 *
 * Anything the host offers that is not covered is `stillNeeds`: Users → Section access and the
 * person preview warn when a column gives the host but not that level of the other section.
 *
 * Nothing is granted implicitly beyond these calls, and the other section's screens stay closed.
 */
import { SECTION_BY_ID, atLeast, type SectionLevel, type SectionLevels } from './registry';

type GrantLevel = Exclude<SectionLevel, 'none'>;

export interface SectionUseCall {
  method: 'GET' | 'POST';
  path: RegExp;
  /** Level needed on the host section for this call. */
  hostLevel: GrantLevel;
}

export interface SectionUse {
  id: string;
  /** Section whose screen embeds the feature. */
  host: string;
  /** Section that owns the API. */
  uses: string;
  /** Plain words: what works through the host alone. */
  covers: string;
  /** What still needs the other section, if anything. */
  stillNeeds: { level: GrantLevel; what: string } | null;
  calls: readonly SectionUseCall[];
}

export const SECTION_USES: readonly SectionUse[] = [
  {
    id: 'automate-connections',
    host: 'build.automate',
    uses: 'govern.connections',
    covers: 'pick connections they own or that are shared with them, and try a document extraction',
    stillNeeds: { level: 'manage', what: 'add a new connection from a flow' },
    calls: [
      { method: 'GET', path: /^\/api\/connections\/?$/, hostLevel: 'view' },
      { method: 'POST', path: /^\/api\/connections\/[^/]+\/extract\/?$/, hostLevel: 'manage' },
    ],
  },
  {
    id: 'automate-knowledge',
    host: 'build.automate',
    uses: 'memory.knowledge',
    covers: 'pick knowledge bases they may see and try a search',
    stillNeeds: null,
    calls: [
      { method: 'GET', path: /^\/api\/knowledge\/?$/, hostLevel: 'view' },
      { method: 'POST', path: /^\/api\/knowledge\/search\/?$/, hostLevel: 'manage' },
    ],
  },
];

/**
 * Alternative section requirements for one API call: [host, level] for every use whose calls match.
 * Pass them after the API's own requirement, so either one lets the call through.
 */
export function embeddedCallRequirements(method: string, pathname: string): (readonly [string, GrantLevel])[] {
  const m = method.toUpperCase();
  const out: (readonly [string, GrantLevel])[] = [];
  for (const u of SECTION_USES) {
    for (const c of u.calls) {
      if (c.method === m && c.path.test(pathname)) out.push([u.host, c.hostLevel] as const);
    }
  }
  return out;
}

export interface SectionUseGap {
  use: SectionUse;
  hostLabel: string;
  usesLabel: string;
  /** Level of the other section that would close the gap. */
  needed: GrantLevel;
  /** One sentence for the matrix and the preview. */
  message: string;
}

/**
 * For a full set of levels (a built-in role, a custom role, or a person): uses whose host is open
 * but whose `stillNeeds` level on the other section is missing.
 */
export function sectionUseGaps(levels: Partial<SectionLevels>): SectionUseGap[] {
  const gaps: SectionUseGap[] = [];
  for (const u of SECTION_USES) {
    if (!u.stillNeeds) continue;
    const hostMin: GrantLevel = u.calls.some((c) => c.hostLevel === 'view') ? 'view' : 'manage';
    if (!atLeast(levels[u.host] ?? 'none', hostMin)) continue;
    if (atLeast(levels[u.uses] ?? 'none', u.stillNeeds.level)) continue;
    const hostLabel = SECTION_BY_ID.get(u.host)?.label ?? u.host;
    const usesLabel = SECTION_BY_ID.get(u.uses)?.label ?? u.uses;
    gaps.push({
      use: u,
      hostLabel,
      usesLabel,
      needed: u.stillNeeds.level,
      message: `${hostLabel} works, and they can ${u.covers}; to ${u.stillNeeds.what} they also need ${usesLabel} (${u.stillNeeds.level === 'manage' ? 'Manage' : 'View'}).`,
    });
  }
  return gaps;
}

/** Sections a section's screen uses, for a short "uses …" note on its matrix row. */
export function usesOf(sectionId: string): SectionUse[] {
  return SECTION_USES.filter((u) => u.host === sectionId);
}
