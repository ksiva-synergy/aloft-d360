/**
 * Section access: which screens a person can open, and whether they can take actions there.
 *
 * Separate from data access (src/lib/access): a section level never grants data, and a data grant
 * never opens a section. Pure module, safe on client and server.
 *
 * Levels:
 *   none   — hidden from the sidebar; the page and its APIs refuse.
 *   view   — opens read-only; action buttons are hidden or disabled.
 *   manage — can take the actions the section offers.
 *
 * How a level is worked out (resolveSectionLevels):
 *   1. Platform admins get `manage` on every section.
 *   2. Otherwise: the highest of the built-in role defaults the person holds, and any
 *      `section:<id>:view|manage` permission keys carried by their roles (bundles).
 *   3. Then capped: `viewOnly` sections never go above view; `manageIsPlatformAdminOnly` sections
 *      (all of Data Estate) never give manage to anyone but a platform admin.
 *
 * `enforced` marks sections whose pages and APIs check this today. Other sections are listed so
 * bundles and the matrix can be built against one registry; until they are enforced, their
 * current behavior is unchanged and the sidebar keeps showing them.
 */

export type SectionLevel = 'none' | 'view' | 'manage';
export type SectionGroup = 'home' | 'build' | 'memory' | 'estate' | 'govern';
export type DefaultRole = 'readonly' | 'member' | 'admin';

export interface SectionDef {
  id: string;
  label: string;
  group: SectionGroup;
  /** UI paths (prefix match) that belong to this section. */
  paths: string[];
  /** Plain words: what `view` shows. */
  view: string;
  /** Plain words: what `manage` adds. Empty for view-only sections. */
  manage: string;
  defaults: Record<DefaultRole, SectionLevel>;
  viewOnly?: boolean;
  manageIsPlatformAdminOnly?: boolean;
  enforced?: boolean;
}

const ESTATE_DEFAULTS: Record<DefaultRole, SectionLevel> = { readonly: 'none', member: 'none', admin: 'view' };
const ADMIN_VIEW: Record<DefaultRole, SectionLevel> = { readonly: 'none', member: 'none', admin: 'view' };
const MEMBER_TOOL: Record<DefaultRole, SectionLevel> = { readonly: 'view', member: 'manage', admin: 'manage' };
const EVERYONE_VIEW: Record<DefaultRole, SectionLevel> = { readonly: 'view', member: 'view', admin: 'view' };
/** Connections are people's own; members and admins manage theirs. */
const MEMBER_OWN: Record<DefaultRole, SectionLevel> = { readonly: 'none', member: 'manage', admin: 'manage' };

const estate = (id: string, label: string, paths: string[], view: string, manage: string): SectionDef => ({
  id: `estate.${id}`,
  label,
  group: 'estate',
  paths,
  view,
  manage,
  defaults: ESTATE_DEFAULTS,
  manageIsPlatformAdminOnly: true,
  enforced: true,
});

export const SECTIONS: SectionDef[] = [
  // ── Home ──
  { id: 'home', label: 'Home', group: 'home', paths: ['/dashboard'], view: 'Home page', manage: '', defaults: EVERYONE_VIEW, viewOnly: true },

  // ── Build ──
  { id: 'build.inspector', label: 'Inspector', group: 'build', paths: ['/inspector'], view: 'Own sessions', manage: 'Ask questions, save sessions', defaults: MEMBER_TOOL },
  { id: 'build.agents', label: 'Agents', group: 'build', paths: ['/agent-lab/agents'], view: 'Use published agents', manage: 'Create, edit, test, and publish agents', defaults: MEMBER_TOOL },
  { id: 'build.dashboards', label: 'Dashboards', group: 'build', paths: ['/inspector/dashboards'], view: 'Shared dashboards', manage: 'Create, edit, and share dashboards', defaults: MEMBER_TOOL },
  { id: 'build.metrics', label: 'Metrics', group: 'build', paths: ['/agent-lab/metrics'], view: 'Metric definitions', manage: 'Define and change metrics', defaults: ADMIN_VIEW },
  { id: 'build.teach', label: 'Teach', group: 'build', paths: ['/agent-lab/teach'], view: 'Teach sessions', manage: 'Run teach sessions, hand off candidates', defaults: ADMIN_VIEW },
  { id: 'build.automate', label: 'Automate', group: 'build', paths: ['/agent-lab/automate'], view: 'Flows and runs', manage: 'Create, run, and schedule flows', defaults: ADMIN_VIEW },
  { id: 'build.performance', label: 'Performance Lab', group: 'build', paths: ['/performance-lab'], view: 'Eval results', manage: 'Run evals', defaults: ADMIN_VIEW },
  { id: 'build.bandits', label: 'Bandits', group: 'build', paths: ['/agent-lab/bandits'], view: 'Experiments', manage: 'Change experiments', defaults: ADMIN_VIEW },
  { id: 'build.history', label: 'History', group: 'build', paths: ['/agent-lab/history'], view: 'Own runs', manage: "Everyone's runs", defaults: ADMIN_VIEW },

  // ── Memory ──
  { id: 'memory.knowledge', label: 'Knowledge', group: 'memory', paths: ['/agent-lab/knowledge'], view: 'Knowledge bases', manage: 'Edit knowledge bases', defaults: ADMIN_VIEW },
  { id: 'memory.foer', label: 'FOER', group: 'memory', paths: ['/agent-lab/memory'], view: 'Agent memory', manage: 'Approve and reject memory', defaults: ADMIN_VIEW },
  { id: 'memory.ops', label: 'FOER Ops', group: 'memory', paths: ['/agent-lab/memory/ops'], view: 'Memory operations', manage: 'Run memory operations', defaults: ADMIN_VIEW },
  { id: 'memory.contributions', label: 'Contributions', group: 'memory', paths: ['/agent-lab/memory/contributions'], view: 'Contributions', manage: 'Approve contributions', defaults: ADMIN_VIEW },

  // ── Data Estate (enforced; actions are platform-admin only) ──
  estate('overview', 'Overview', ['/agent-lab/estate'], 'Estate summary and coverage', 'Refresh coverage'),
  estate('catalog', 'Catalog', ['/agent-lab/estate/catalog', '/agent-lab/estate/object', '/agent-lab/estate/objects'], 'Every catalog, schema, table, and column; object pages', 'Harvest, re-harvest, row counts, confirm semantics, resolve PII'),
  estate('entities', 'Entities', ['/agent-lab/estate/entities'], 'Entity models', 'Promote entity models'),
  estate('lineage', 'Lineage', ['/agent-lab/estate/lineage'], 'Lineage graph', 'Change relationships'),
  estate('jobs', 'Jobs', ['/agent-lab/estate/jobs'], 'Jobs, runs, and logs', 'Start, continue, retry, cancel, and schedule harvest jobs'),
  estate('mapper', 'Mapper', ['/agent-lab/estate/mapper'], 'Mappings', 'Run and edit mappings'),
  estate('silo', 'Silo Finder', ['/agent-lab/estate/silo'], 'Silo links', 'Run scans, confirm or reject links'),

  // ── Govern (enforced; admins view only, platform admins act — user decision 2026-11-06) ──
  { id: 'govern.models', label: 'Models', group: 'govern', paths: ['/agent-staging/models'], view: 'Models and gateway settings', manage: 'Change models and gateway settings', defaults: ADMIN_VIEW, enforced: true },
  { id: 'govern.users', label: 'Users', group: 'govern', paths: ['/agent-staging/users'], view: 'People, roles, and bundles', manage: 'Invite people, change roles, block or remove people', defaults: ADMIN_VIEW, enforced: true },
  { id: 'govern.data-access', label: 'Data access', group: 'govern', paths: ['/agent-staging/data-access'], view: 'Data map, people, labels, log', manage: 'Map data, manage departments, grants, and labels', defaults: ADMIN_VIEW, enforced: true },
  { id: 'govern.cost', label: 'Cost monitor', group: 'govern', paths: ['/agent-staging/cost'], view: 'Spend', manage: 'Set budgets', defaults: ADMIN_VIEW, enforced: true },
  { id: 'govern.policies', label: 'Policies', group: 'govern', paths: ['/agent-staging/policies'], view: 'Policies', manage: 'Add, edit, and remove policies', defaults: ADMIN_VIEW, enforced: true },
  { id: 'govern.connections', label: 'Connections', group: 'govern', paths: ['/agent-staging/connections'], view: 'Connections shared with you', manage: 'Add and edit your own connections', defaults: MEMBER_OWN, enforced: true },
  { id: 'govern.audit', label: 'Audit log', group: 'govern', paths: ['/agent-staging/audit'], view: 'Audit log', manage: '', defaults: ADMIN_VIEW, viewOnly: true, enforced: true },
  { id: 'govern.docs', label: 'Docs', group: 'govern', paths: ['/docs'], view: 'Docs', manage: '', defaults: EVERYONE_VIEW, viewOnly: true },
];

export const SECTION_BY_ID: ReadonlyMap<string, SectionDef> = new Map(SECTIONS.map((s) => [s.id, s]));

export const SECTION_GROUP_LABEL: Record<SectionGroup, string> = {
  home: 'Home',
  build: 'Build',
  memory: 'Memory',
  estate: 'Data Estate',
  govern: 'Govern',
};

const RANK: Record<SectionLevel, number> = { none: 0, view: 1, manage: 2 };

export function atLeast(level: SectionLevel, min: SectionLevel): boolean {
  return RANK[level] >= RANK[min];
}

function higher(a: SectionLevel, b: SectionLevel): SectionLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Permission key a role (bundle) carries to give a section level. */
export function sectionPermissionKey(sectionId: string, level: Exclude<SectionLevel, 'none'>): string {
  return `section:${sectionId}:${level}`;
}

const DEFAULT_ROLES: DefaultRole[] = ['readonly', 'member', 'admin'];

/** The four built-in roles. Every other role is a bundle: it only carries `section:` keys. */
export const BUILT_IN_ROLES = ['platform_admin', 'admin', 'member', 'readonly'] as const;

export function isBuiltInRole(name: string): boolean {
  return (BUILT_IN_ROLES as readonly string[]).includes(name);
}

/** Highest level a bundle may give on a section (view-only and Data Estate sections stop at view). */
export function bundleCeiling(s: SectionDef): Exclude<SectionLevel, 'none'> {
  return s.viewOnly || s.manageIsPlatformAdminOnly ? 'view' : 'manage';
}

/**
 * Custom roles: a role that sets every section exactly (it can take access away, unlike a bundle).
 * It carries `section:role-base:<readonly|member|admin>` plus its section keys. The person also holds
 * that built-in base role, which decides everything outside sections (inspector use, sessions, rank).
 * When a person's permissions include a base key, role defaults are skipped: levels come from keys only.
 */
export const ROLE_BASE_PREFIX = 'section:role-base:';

export function roleBaseKey(base: DefaultRole): string {
  return `${ROLE_BASE_PREFIX}${base}`;
}

/** The base role a custom role's keys name, or null for a bundle. */
export function baseFromKeys(keys: Iterable<string>): DefaultRole | null {
  for (const k of keys) {
    if (k.startsWith(ROLE_BASE_PREFIX)) {
      const base = k.slice(ROLE_BASE_PREFIX.length);
      if ((DEFAULT_ROLES as string[]).includes(base)) return base as DefaultRole;
    }
  }
  return null;
}

/** Prisma select for a user's roles that also tells custom roles apart (their base key). */
export const ROLE_WITH_BASE_SELECT = {
  select: {
    role: {
      select: {
        id: true,
        name: true,
        permissions: {
          where: { permission: { key: { startsWith: ROLE_BASE_PREFIX } } },
          select: { permission: { select: { key: true } } },
        },
      },
    },
  },
} as const;

export interface RoleWithBase {
  role: { id: string; name: string; permissions?: { permission: { key: string } }[] };
}

/** A user's custom role (if any) and bundles, from roles loaded with ROLE_WITH_BASE_SELECT. */
export function splitSectionRoles(roles: RoleWithBase[]): {
  customRole: { id: string; name: string; base: DefaultRole } | null;
  bundles: { id: string; name: string }[];
} {
  let customRole: { id: string; name: string; base: DefaultRole } | null = null;
  const bundles: { id: string; name: string }[] = [];
  for (const { role } of roles) {
    if (isBuiltInRole(role.name)) continue;
    const base = baseFromKeys((role.permissions ?? []).map((p) => p.permission.key));
    if (base) customRole ??= { id: role.id, name: role.name, base };
    else bundles.push({ id: role.id, name: role.name });
  }
  return { customRole, bundles };
}

/** A built-in role's defaults as a full level map (custom roles start from this). */
export function defaultLevels(role: DefaultRole): SectionLevels {
  const out: SectionLevels = {};
  for (const s of SECTIONS) out[s.id] = s.defaults[role];
  return out;
}

/** Section levels a set of permission keys gives on their own (what a bundle carries). */
export function levelsFromKeys(keys: Iterable<string>): SectionLevels {
  const set = new Set(keys);
  const out: SectionLevels = {};
  for (const s of SECTIONS) {
    if (set.has(sectionPermissionKey(s.id, 'manage'))) out[s.id] = 'manage';
    else if (set.has(sectionPermissionKey(s.id, 'view'))) out[s.id] = 'view';
  }
  return out;
}

/** Permission keys for a bundle's levels; levels above a section's ceiling are lowered to it. */
export function keysForLevels(levels: Record<string, SectionLevel | undefined>): string[] {
  const keys: string[] = [];
  for (const s of SECTIONS) {
    const l = levels[s.id];
    if (!l || l === 'none') continue;
    keys.push(sectionPermissionKey(s.id, l === 'manage' ? bundleCeiling(s) : 'view'));
  }
  return keys;
}

export type SectionLevels = Record<string, SectionLevel>;

/**
 * Levels for every section, from the person's role names and the permission keys their roles carry.
 * A person with no roles counts as Member (matches DEFAULT_ROLE in src/lib/rbac.ts).
 * With a custom role (a `section:role-base:*` key), defaults are skipped and keys decide.
 */
export function resolveSectionLevels(roleNames: readonly string[], permissions: ReadonlySet<string> | readonly string[]): SectionLevels {
  const perms = permissions instanceof Set ? permissions : new Set(permissions as readonly string[]);
  const names = roleNames.length ? roleNames : ['member'];
  const platformAdmin = names.includes('platform_admin');
  const customRole = baseFromKeys(perms) !== null;
  const out: SectionLevels = {};
  for (const s of SECTIONS) {
    if (platformAdmin) {
      out[s.id] = s.viewOnly ? 'view' : 'manage';
      continue;
    }
    let level: SectionLevel = 'none';
    // A custom role replaces the role defaults entirely; otherwise start from the built-in role.
    if (!customRole) for (const r of DEFAULT_ROLES) if (names.includes(r)) level = higher(level, s.defaults[r]);
    if (perms.has(sectionPermissionKey(s.id, 'view'))) level = higher(level, 'view');
    if (perms.has(sectionPermissionKey(s.id, 'manage'))) level = higher(level, 'manage');
    if (level === 'manage' && (s.viewOnly || s.manageIsPlatformAdminOnly)) level = 'view';
    out[s.id] = level;
  }
  return out;
}

/** The section a UI path belongs to (longest matching prefix), or null. */
export function sectionForPath(pathname: string): SectionDef | null {
  let best: SectionDef | null = null;
  let bestLen = -1;
  for (const s of SECTIONS) {
    for (const p of s.paths) {
      if ((pathname === p || pathname.startsWith(p + '/')) && p.length > bestLen) {
        best = s;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** Sidebar rule: hide only enforced sections the person cannot open. */
export function hiddenInNav(levels: SectionLevels | null, href: string): boolean {
  if (!levels) return false;
  const s = sectionForPath(href);
  if (!s || !s.enforced) return false;
  return levels[s.id] === 'none';
}
