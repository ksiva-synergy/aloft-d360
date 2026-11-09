/**
 * Simplified access model, decision engine (docs/access/simplified-access-model.md §3).
 *
 * Two ideas:
 *   Access       holder can USE a catalog / schema / table (optionally EXPORT), or is BLOCKED there.
 *   Protections  named sensitive data on whole paths (catalog / schema / table) or on columns;
 *                only holders given the protection see values (Exact values or Totals only).
 * Holders: a person, a group, or a built-in group derived from app roles (Everyone / Members / Admins).
 *
 * Pure functions, no I/O. `fromLegacy()` builds the model from today's PolicySnapshot so the old and
 * new engines can be compared rule for rule before callers switch (S1 exit criterion).
 */
import { effectiveDataRoles } from './roles';
import type { DataTier } from '@/lib/databricks/sp-roles';
import type { AccessLevel, AccessPrincipal, AuthorizePathsResult, Decision, DenyReason, PolicySnapshot, SensitivityLabel, TagGrantLevel } from './types';

/* ── Model ──────────────────────────────────────────────────────────────────── */

/** Built-in groups map to app roles and follow the role ladder (a Member grant also covers Admins). */
export const BUILTIN_GROUPS = [
  { id: 'readonly', name: 'Everyone' },
  { id: 'member', name: 'Members' },
  { id: 'admin', name: 'Admins' },
] as const;

export type Holder =
  | { kind: 'person'; id: string }
  | { kind: 'group'; id: string }
  /** App role name: readonly (Everyone), member (Members), admin (Admins), or a custom role. */
  | { kind: 'builtin'; id: string };

export interface AccessRule {
  holder: Holder;
  /** Lowercase catalog, catalog.schema or catalog.schema.table. Covers everything below it. */
  path: string;
  effect: 'use' | 'block';
  allowExport: boolean;
  expiresAt: Date | null;
}

export interface Protection {
  id: string;
  name: string;
  /** Stable key; `confidential` / `restricted` (copied from labels) also pick the warehouse tier. */
  key?: string;
}

/** Where a protection applies: a whole path (column null) or one column of a table. */
export interface ProtectedTarget {
  protectionId: string;
  path: string;
  column: string | null;
}

export interface ProtectionGrant {
  protectionId: string;
  holder: Exclude<Holder, { kind: 'builtin' }>;
  level: TagGrantLevel;
  expiresAt: Date | null;
}

export interface Membership {
  groupId: string;
  expiresAt: Date | null;
}

export interface AccessModel {
  rules: AccessRule[];
  protections: Map<string, Protection>;
  targets: ProtectedTarget[];
  protectionGrants: ProtectionGrant[];
  /** userId → group memberships (departments and access groups are both groups). */
  membersByUser: Map<string, Membership[]>;
  /** No access rules exist yet: unprotected data is open so nobody is locked out during setup. */
  bootstrapOpen: boolean;
}

/** The person a decision is about. `roles` are the app roles they hold. */
export interface Person {
  userId: string;
  roles: string[];
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

const norm = (s: string) => s.trim().toLowerCase();

/** `catalog.schema` covers `catalog.schema.table`; a path covers itself. */
export function covers(parent: string, child: string): boolean {
  const p = norm(parent);
  const c = norm(child);
  return c === p || c.startsWith(`${p}.`);
}

const active = (expiresAt: Date | null, now: number) => !expiresAt || expiresAt.getTime() > now;

/** App role that sees all data: every path (Use + export), past any Block, every protection at Exact values. */
export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const isPlatformAdminPerson = (person: Person) => person.roles.includes(PLATFORM_ADMIN_ROLE);

function holderMatches(h: Holder, person: Person, groups: Set<string>, roles: Set<string>): boolean {
  if (h.kind === 'person') return h.id === person.userId;
  if (h.kind === 'group') return groups.has(h.id);
  return roles.has(h.id);
}

function context(model: AccessModel, person: Person, now: number) {
  const groups = new Set(
    (model.membersByUser.get(person.userId) ?? []).filter((m) => active(m.expiresAt, now)).map((m) => m.groupId),
  );
  const roles = new Set(effectiveDataRoles(person.roles));
  return { groups, roles };
}

const LEVEL_RANK: Record<TagGrantLevel | 'none', number> = { none: 0, aggregate: 1, full: 2 };

/** The person's level on one protection (best of direct and group grants). */
export function protectionLevel(
  model: AccessModel,
  person: Person,
  protectionId: string,
  now: number = Date.now(),
): TagGrantLevel | 'none' {
  if (isPlatformAdminPerson(person)) return 'full';
  const { groups, roles } = context(model, person, now);
  let best: TagGrantLevel | 'none' = 'none';
  for (const g of model.protectionGrants) {
    if (g.protectionId !== protectionId || !active(g.expiresAt, now)) continue;
    if (!holderMatches(g.holder, person, groups, roles)) continue;
    if (LEVEL_RANK[g.level] > LEVEL_RANK[best]) best = g.level;
  }
  return best;
}

/** Protections on a whole path covering this object (catalog, schema or table level). */
export function pathProtections(model: AccessModel, objectPath: string): Protection[] {
  const ids = new Set(model.targets.filter((t) => t.column === null && covers(t.path, objectPath)).map((t) => t.protectionId));
  return [...ids].map((id) => model.protections.get(id)).filter((p): p is Protection => !!p);
}

/* ── Table level: can the person open this data? ───────────────────────────── */

export type OpenNeed = 'use' | 'export';

export type OpenDecision =
  | { ok: true; reason?: 'bootstrap_open' | 'platform_admin' }
  | { ok: false; reason: 'blocked' | 'no_access' }
  | { ok: false; reason: 'protected'; protections: Protection[] };

/**
 * 1. A Block on the path (or a parent) for the person or any of their groups → blocked.
 * 2. Use on the path (or a parent) → yes; Export needs a rule with Allow export.
 *    While no rules exist at all (bootstrap), unprotected data is open.
 * 0. Platform admins open everything (Use + export, past any Block and protection).
 * 3. Whole-path protections: the person needs every one (Totals only is enough to open; columns
 *    then behave as protected columns, see decideColumnUse).
 */
export function canOpen(
  model: AccessModel,
  person: Person,
  objectPath: string,
  need: OpenNeed,
  now: number = Date.now(),
): OpenDecision {
  const path = norm(objectPath);
  if (isPlatformAdminPerson(person)) return { ok: true, reason: 'platform_admin' };
  const { groups, roles } = context(model, person, now);
  const applies = (r: AccessRule) =>
    active(r.expiresAt, now) && covers(r.path, path) && holderMatches(r.holder, person, groups, roles);

  if (model.rules.some((r) => r.effect === 'block' && applies(r))) return { ok: false, reason: 'blocked' };

  let opened = false;
  if (model.bootstrapOpen) {
    opened = true;
  } else {
    const uses = model.rules.filter((r) => r.effect === 'use' && applies(r));
    opened = need === 'export' ? uses.some((r) => r.allowExport) : uses.length > 0;
  }
  if (!opened) return { ok: false, reason: 'no_access' };

  const missing = pathProtections(model, path).filter((p) => protectionLevel(model, person, p.id, now) === 'none');
  if (missing.length) return { ok: false, reason: 'protected', protections: missing };

  return model.bootstrapOpen ? { ok: true, reason: 'bootstrap_open' } : { ok: true };
}

export type GrantPreview =
  | { ok: true }
  | { ok: false; reason: 'blocked'; blockedBy: string[] }
  | { ok: false; reason: 'protected'; protections: Protection[] };

/**
 * What would still stop the person opening `objectPath` if they were given Use on it (review H6).
 * A Block always wins, and Use on a path does not give its whole-path protections.
 */
export function previewPathGrant(
  model: AccessModel,
  person: Person,
  objectPath: string,
  need: OpenNeed,
  now: number = Date.now(),
): GrantPreview {
  const path = norm(objectPath);
  const added: AccessRule = { holder: { kind: 'person', id: person.userId }, path, effect: 'use', allowExport: need === 'export', expiresAt: null };
  const d = canOpen({ ...model, rules: [...model.rules, added] }, person, path, need, now);
  if (d.ok) return { ok: true };
  if (d.reason === 'protected') return { ok: false, reason: 'protected', protections: d.protections };
  const { groups, roles } = context(model, person, now);
  const blockedBy = model.rules
    .filter((r) => r.effect === 'block' && active(r.expiresAt, now) && covers(r.path, path) && holderMatches(r.holder, person, groups, roles))
    .map((r) => r.path);
  return { ok: false, reason: 'blocked', blockedBy: [...new Set(blockedBy)].sort() };
}

/** Decide for a principal; system principals (harvest, sync, …) are not governed by this model. */
export function canOpenFor(model: AccessModel, principal: AccessPrincipal, roles: string[], objectPath: string, need: OpenNeed, now?: number): OpenDecision {
  if (principal.kind !== 'user') return { ok: true };
  return canOpen(model, { userId: principal.userId, roles }, objectPath, need, now);
}

/* ── Column level: what does the person get for one column use? ─────────────── */

export type ColumnUse = 'output' | 'filter' | 'aggregate';
export type ColumnOutcome = 'full' | 'aggregate' | 'masked' | 'refused';

/**
 * Protections on the column itself plus any whole-path protection covering its table.
 * Lowest level across them decides:
 *   full → full;  aggregate → aggregate for aggregates, masked for output, refused for filter;
 *   none → masked for output and aggregates, refused for filter.
 * Assumes canOpen() already allowed the table.
 */
export function decideColumnUse(
  model: AccessModel,
  person: Person,
  table: string,
  column: string,
  use: ColumnUse,
  now: number = Date.now(),
): { outcome: ColumnOutcome; missing: Protection[] } {
  const t = norm(table);
  const c = norm(column);
  const ids = new Set(
    model.targets
      .filter((x) => (x.column === null ? covers(x.path, t) : norm(x.path) === t && norm(x.column) === c))
      .map((x) => x.protectionId),
  );
  if (ids.size === 0) return { outcome: 'full', missing: [] };

  let lowest: TagGrantLevel | 'none' = 'full';
  const missing: Protection[] = [];
  for (const id of ids) {
    const level = protectionLevel(model, person, id, now);
    if (level !== 'full') {
      const p = model.protections.get(id);
      if (p) missing.push(p);
    }
    if (LEVEL_RANK[level] < LEVEL_RANK[lowest]) lowest = level;
  }

  let outcome: ColumnOutcome;
  if (lowest === 'full') outcome = 'full';
  else if (use === 'filter') outcome = 'refused';
  else if (lowest === 'aggregate' && use === 'aggregate') outcome = 'aggregate';
  else outcome = 'masked';
  return { outcome, missing };
}

/* ── From today's rules (migration mapping, §5) ────────────────────────────── */

export const LEGACY_LABEL_PROTECTION: Record<Exclude<SensitivityLabel, 'internal'>, Protection> = {
  confidential: { id: 'legacy-label:confidential', name: 'Confidential', key: 'confidential' },
  restricted: { id: 'legacy-label:restricted', name: 'Restricted', key: 'restricted' },
};

/**
 * Build the new model from today's snapshot:
 *   department → group; access group → group; role grant → built-in group
 *   discover → (dropped: names are visible to everyone); query → use; export → use + export; deny → block
 *   label → whole-path protection "Confidential" / "Restricted"
 *   clearance → direct protection grant (Restricted also gets Confidential)
 *   column tags / tag grants / access groups → unchanged
 */
export function fromLegacy(snapshot: PolicySnapshot): AccessModel {
  const rules: AccessRule[] = [];
  for (const g of snapshot.grants) {
    if (g.effect === 'allow' && g.level === 'discover') continue;
    const holder: Holder =
      g.principalType === 'user'
        ? { kind: 'person', id: g.principalId }
        : g.principalType === 'department'
          ? { kind: 'group', id: g.principalId }
          : { kind: 'builtin', id: g.principalId };
    rules.push({
      holder,
      path: norm(g.path),
      effect: g.effect === 'deny' ? 'block' : 'use',
      allowExport: g.effect === 'allow' && g.level === 'export',
      expiresAt: g.expiresAt,
    });
  }

  const protections = new Map<string, Protection>();
  const targets: ProtectedTarget[] = [];
  const protectionGrants: ProtectionGrant[] = [];

  for (const l of snapshot.labels) {
    const p = LEGACY_LABEL_PROTECTION[l.label];
    protections.set(p.id, p);
    targets.push({ protectionId: p.id, path: norm(l.path), column: null });
    // A Restricted label also needs Confidential clearance today (clearance is a ladder).
    if (l.label === 'restricted') {
      const c = LEGACY_LABEL_PROTECTION.confidential;
      protections.set(c.id, c);
    }
  }
  for (const [userId, level] of snapshot.clearances) {
    const ids = level === 'restricted' ? ['restricted', 'confidential'] : ['confidential'];
    for (const k of ids) {
      protectionGrants.push({
        protectionId: LEGACY_LABEL_PROTECTION[k as 'confidential' | 'restricted'].id,
        holder: { kind: 'person', id: userId },
        level: 'full',
        expiresAt: null,
      });
    }
  }

  const membersByUser = new Map<string, Membership[]>();
  for (const [userId, deptIds] of snapshot.membersByUser) {
    membersByUser.set(userId, deptIds.map((groupId) => ({ groupId, expiresAt: null })));
  }

  const cols = snapshot.columns;
  if (cols) {
    for (const t of cols.tags.values()) protections.set(t.id, { id: t.id, name: t.name });
    for (const [table, byColumn] of cols.columnTags) {
      for (const [column, tagIds] of byColumn) {
        for (const id of tagIds) targets.push({ protectionId: id, path: table, column });
      }
    }
    for (const g of cols.tagGrants) {
      protectionGrants.push({
        protectionId: g.tagId,
        holder: g.principalType === 'group' ? { kind: 'group', id: g.principalId } : { kind: 'person', id: g.principalId },
        level: g.level,
        expiresAt: g.expiresAt,
      });
    }
    for (const [userId, list] of cols.groupsByUser) {
      membersByUser.set(userId, [...(membersByUser.get(userId) ?? []), ...list.map((m) => ({ groupId: m.groupId, expiresAt: m.expiresAt }))]);
    }
  }

  return {
    rules,
    protections,
    targets,
    protectionGrants,
    membersByUser,
    bootstrapOpen: snapshot.legacyOpen,
  };
}

/* ── Adapter for request-time checks (authorize.ts, visibility.ts) ─────────── */

/** Warehouse tier from whole-path protections: Restricted > Confidential > internal. */
export function tierForPath(model: AccessModel, objectPath: string): DataTier {
  const keys = new Set(pathProtections(model, objectPath).map((p) => p.key));
  if (keys.has('restricted')) return 'restricted';
  if (keys.has('confidential')) return 'confidential';
  return 'internal';
}

const REASON: Record<'blocked' | 'no_access' | 'protected', DenyReason> = {
  blocked: 'explicit_deny',
  no_access: 'no_grant',
  protected: 'needs_clearance',
};

/**
 * One path at an old-style level. Discover is always allowed (names are visible to everyone, A1);
 * query → Use; export → Use + export. System principals are not governed here.
 */
export function decideLevel(model: AccessModel, principal: AccessPrincipal, objectPath: string, level: AccessLevel, now?: number): Decision {
  if (principal.kind !== 'user') return { allowed: true, tier: 'internal' };
  if (level === 'discover') return { allowed: true, tier: tierForPath(model, objectPath) };
  const d = canOpen(model, { userId: principal.userId, roles: principal.roles ?? [] }, objectPath, level === 'export' ? 'export' : 'use', now);
  if (d.ok) return d.reason === 'bootstrap_open' ? { allowed: true, tier: tierForPath(model, objectPath), reason: 'legacy_open' } : { allowed: true, tier: tierForPath(model, objectPath) };
  return { allowed: false, reason: REASON[d.reason] };
}

const TIER_RANK: Record<DataTier, number> = { internal: 0, confidential: 1, restricted: 2 };

/** Every path in a query must pass; the query runs at the highest tier among them. */
export function authorizeWithModel(model: AccessModel, principal: AccessPrincipal, paths: string[], level: AccessLevel, now?: number): AuthorizePathsResult {
  const unique = [...new Set(paths.map((p) => norm(p)).filter(Boolean))];
  if (unique.length === 0) return { ok: false, reason: 'no_grant', visiblePaths: [] };
  let tier: DataTier = 'internal';
  const decisions = new Map<string, Decision>();
  for (const path of unique) {
    const d = decideLevel(model, principal, path, level, now);
    decisions.set(path, d);
    if (!d.allowed) {
      // Names are visible to everyone (A1), so the refusal may name every path in the query.
      return { ok: false, reason: d.reason, failedPath: path, visiblePaths: unique };
    }
    if (TIER_RANK[d.tier] > TIER_RANK[tier]) tier = d.tier;
  }
  return { ok: true, tier, decisions };
}

/** Names of the protections a person is missing on a path (for refusal messages). */
export function missingPathProtections(model: AccessModel, principal: AccessPrincipal, objectPath: string, now?: number): string[] {
  if (principal.kind !== 'user') return [];
  const person = { userId: principal.userId, roles: principal.roles ?? [] };
  return pathProtections(model, objectPath)
    .filter((p) => protectionLevel(model, person, p.id, now) === 'none')
    .map((p) => p.name);
}

export type { SensitivityLabel };
