/**
 * Pure explanations of §4.1 decisions for the admin console ("Why?").
 *
 * `explainUserPath` must agree with `decide()` at every level; see
 * `__tests__/explain.test.ts`, which checks both against the same matrix.
 */
import { levelAtLeast, maxLevel } from './levels';
import type {
  AccessLevel,
  DecideUserInput,
  DenyReason,
  GrantPrincipalType,
  GrantRow,
  LabelRow,
  PolicySnapshot,
  SensitivityLabel,
} from './types';

const LABEL_RANK: Record<SensitivityLabel, number> = { internal: 0, confidential: 1, restricted: 2 };

export interface GrantRef {
  path: string;
  principalType: GrantPrincipalType;
  principalId: string;
  level: AccessLevel;
  effect: 'allow' | 'deny';
}

export interface LabelSource {
  /** Highest label on the chain (Internal when none). */
  label: SensitivityLabel;
  /** Path whose row set that label; null for Internal. */
  from: string | null;
  /** Label row on exactly this path, if any. */
  own: 'confidential' | 'restricted' | null;
}

export interface UserPathExplanation {
  path: string;
  legacyOpen: boolean;
  clearance: SensitivityLabel;
  label: LabelSource;
  /** Deny that blocks the path (on the path or an ancestor). */
  deny: GrantRef | null;
  /** Allow grant that supplies the highest level. */
  allow: GrantRef | null;
  /** Highest level any allow grant covers, before label checks. */
  grantedLevel: AccessLevel | null;
  /** Highest level the person may actually use. Null when nothing is allowed. */
  allowedLevel: AccessLevel | null;
  /** Why nothing is allowed. Null when allowedLevel is set. */
  reason: DenyReason | null;
}

/** One holder's (department or role) grant state on a node. */
export interface DepartmentNodeAccess {
  /** Allow grant on exactly this path. */
  direct: AccessLevel | null;
  /** Deny grant on exactly this path. */
  directDeny: boolean;
  /** Highest allow inherited from a parent. */
  inherited: AccessLevel | null;
  inheritedFrom: string | null;
  /** Parent path with a deny for this department. */
  blockedBy: string | null;
  /** Grants this department holds below this node. */
  grantsInside: number;
}

function norm(path: string): string {
  return path.trim().toLowerCase();
}

/** True when `objectPath` is `grantPath` or below it. */
export function pathCovers(grantPath: string, objectPath: string): boolean {
  const g = norm(grantPath);
  const o = norm(objectPath);
  return o === g || o.startsWith(`${g}.`);
}

function isLive(grant: GrantRow, now: number): boolean {
  return !grant.expiresAt || grant.expiresAt.getTime() >= now;
}

function toRef(g: GrantRow): GrantRef {
  return {
    path: g.path,
    principalType: g.principalType,
    principalId: g.principalId,
    level: g.level,
    effect: g.effect,
  };
}

function depth(path: string): number {
  return path.split('.').length;
}

export function labelSource(path: string, labels: LabelRow[]): LabelSource {
  const p = norm(path);
  let best: SensitivityLabel = 'internal';
  let from: string | null = null;
  let own: LabelSource['own'] = null;
  for (const row of labels) {
    if (!pathCovers(row.path, p)) continue;
    if (norm(row.path) === p) own = row.label;
    const rank = LABEL_RANK[row.label];
    const better = rank > LABEL_RANK[best];
    const tieShallower = rank === LABEL_RANK[best] && from !== null && depth(row.path) < depth(from);
    if (better || tieShallower) {
      best = row.label;
      from = norm(row.path);
    }
  }
  return { label: best, from, own };
}

function holderMatches(g: GrantRow, user: DecideUserInput): boolean {
  if (g.principalType === 'user') return g.principalId === user.userId;
  if (g.principalType === 'role') return (user.roles ?? []).includes(g.principalId);
  return user.departmentIds.includes(g.principalId);
}

export function explainUserPath(
  user: DecideUserInput,
  objectPath: string,
  policy: PolicySnapshot,
  now: number = Date.now(),
): UserPathExplanation {
  const path = norm(objectPath);
  const label = labelSource(path, policy.labels);
  const base = {
    path,
    legacyOpen: policy.legacyOpen,
    clearance: user.clearance,
    label,
  };
  const clearanceOk = LABEL_RANK[user.clearance] >= LABEL_RANK[label.label];

  if (policy.legacyOpen) {
    return {
      ...base,
      deny: null,
      allow: null,
      grantedLevel: null,
      allowedLevel: clearanceOk ? 'export' : null,
      reason: clearanceOk ? null : 'needs_clearance',
    };
  }

  const relevant = policy.grants.filter(
    (g) => isLive(g, now) && holderMatches(g, user) && pathCovers(g.path, path),
  );

  const deny = relevant
    .filter((g) => g.effect === 'deny')
    .sort((a, b) => depth(a.path) - depth(b.path))[0];
  if (deny) {
    return {
      ...base,
      deny: toRef(deny),
      allow: null,
      grantedLevel: null,
      allowedLevel: null,
      reason: 'explicit_deny',
    };
  }

  let grantedLevel: AccessLevel | null = null;
  let allow: GrantRow | null = null;
  for (const g of relevant) {
    if (g.effect !== 'allow') continue;
    if (!grantedLevel || !levelAtLeast(grantedLevel, g.level)) {
      grantedLevel = g.level;
      allow = g;
    }
  }

  if (!grantedLevel) {
    return { ...base, deny: null, allow: null, grantedLevel: null, allowedLevel: null, reason: 'no_grant' };
  }
  if (!clearanceOk) {
    return {
      ...base,
      deny: null,
      allow: allow ? toRef(allow) : null,
      grantedLevel,
      allowedLevel: null,
      reason: 'needs_clearance',
    };
  }
  return {
    ...base,
    deny: null,
    allow: allow ? toRef(allow) : null,
    grantedLevel,
    allowedLevel: grantedLevel,
    reason: null,
  };
}

export function departmentNodeAccess(
  departmentId: string,
  objectPath: string,
  grants: GrantRow[],
  now: number = Date.now(),
): DepartmentNodeAccess {
  return holderNodeAccess('department', departmentId, objectPath, grants, now);
}

export function holderNodeAccess(
  principalType: GrantPrincipalType,
  principalId: string,
  objectPath: string,
  grants: GrantRow[],
  now: number = Date.now(),
): DepartmentNodeAccess {
  const path = norm(objectPath);
  const own = grants.filter(
    (g) => g.principalType === principalType && g.principalId === principalId && isLive(g, now),
  );

  let direct: AccessLevel | null = null;
  let directDeny = false;
  let inherited: AccessLevel | null = null;
  let inheritedFrom: string | null = null;
  let blockedBy: string | null = null;
  let grantsInside = 0;

  for (const g of own) {
    const gp = norm(g.path);
    if (gp === path) {
      if (g.effect === 'deny') directDeny = true;
      else direct = maxLevel(direct, g.level);
    } else if (pathCovers(gp, path)) {
      if (g.effect === 'deny') {
        if (!blockedBy || depth(gp) < depth(blockedBy)) blockedBy = gp;
      } else {
        const next = maxLevel(inherited, g.level);
        if (next !== inherited) {
          inherited = next;
          inheritedFrom = gp;
        }
      }
    } else if (pathCovers(path, gp)) {
      grantsInside += 1;
    }
  }

  return { direct, directDeny, inherited, inheritedFrom, blockedBy, grantsInside };
}

/** A department or app role that touches a path. */
export interface PathTag {
  principalType: 'department' | 'role';
  principalId: string;
  /** Allow level that applies here (set here or inherited). Null when only blocked or only set inside. */
  level: AccessLevel | null;
  /** A Block applies here (set here or on a parent). */
  deny: boolean;
  /** Parent path the level or Block comes from. Null when it is set on this exact path. */
  from: string | null;
  /** True when the holder has a grant or Block on exactly this path. */
  direct: boolean;
  /** Grants this holder has below this node. */
  inside: number;
}

/** Every department and app role that touches a path: set here, inherited, or set inside. */
export function pathTags(objectPath: string, grants: GrantRow[], now: number = Date.now()): PathTag[] {
  const path = norm(objectPath);
  const keys = new Map<string, { type: 'department' | 'role'; id: string }>();
  for (const g of grants) {
    if (g.principalType === 'user' || !isLive(g, now)) continue;
    if (pathCovers(g.path, path) || pathCovers(path, g.path)) {
      keys.set(`${g.principalType}:${g.principalId}`, { type: g.principalType, id: g.principalId });
    }
  }
  const tags: PathTag[] = [];
  for (const { type, id } of keys.values()) {
    const a = holderNodeAccess(type, id, path, grants, now);
    const base = { principalType: type, principalId: id, inside: a.grantsInside };
    const direct = a.direct !== null || a.directDeny;
    if (a.blockedBy && !direct) {
      tags.push({ ...base, level: null, deny: true, from: a.blockedBy, direct: false });
    } else if (direct) {
      tags.push({ ...base, level: a.directDeny ? null : a.direct, deny: a.directDeny, from: null, direct: true });
    } else if (a.inherited) {
      tags.push({ ...base, level: a.inherited, deny: false, from: a.inheritedFrom, direct: false });
    } else if (a.grantsInside > 0) {
      tags.push({ ...base, level: null, deny: false, from: null, direct: false });
    }
  }
  return tags;
}
