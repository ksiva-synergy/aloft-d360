/**
 * Pure access decision (§4.1) — no I/O.
 */
import type { DataTier } from '@/lib/databricks/sp-roles';
import { levelAtLeast, maxLevel } from './levels';
import type {
  AccessDecision,
  AccessLevel,
  AccessPrincipal,
  AuthorizePathsResult,
  Decision,
  DecideUserInput,
  DenyReason,
  GrantRow,
  LabelRow,
  PolicySnapshot,
  SensitivityLabel,
} from './types';

const LEVEL_RANK: Record<AccessLevel, number> = {
  discover: 1,
  query: 2,
  export: 3,
};

const LABEL_RANK: Record<SensitivityLabel, number> = {
  internal: 0,
  confidential: 1,
  restricted: 2,
};

const TIER_RANK: Record<DataTier, number> = {
  internal: 0,
  confidential: 1,
  restricted: 2,
};

function normalizePath(path: string): string {
  return path.trim().toLowerCase();
}

export function pathChain(fullPath: string): string[] {
  const p = normalizePath(fullPath);
  const parts = p.split('.').filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(parts.slice(0, i).join('.'));
  }
  return chain;
}

function grantMatchesPath(grantPath: string, objectPath: string): boolean {
  const g = normalizePath(grantPath);
  const o = normalizePath(objectPath);
  return o === g || o.startsWith(`${g}.`);
}

type Holder = { type: GrantRow['principalType']; id: string };

function holdersForUser(userId: string, departmentIds: string[], roles: string[] = []): Holder[] {
  return [
    { type: 'user', id: userId },
    ...departmentIds.map((id) => ({ type: 'department' as const, id })),
    ...roles.map((id) => ({ type: 'role' as const, id })),
  ];
}

function grantApplies(grant: GrantRow, holder: Holder, objectPath: string): boolean {
  if (grant.expiresAt && grant.expiresAt.getTime() < Date.now()) return false;
  if (grant.principalType !== holder.type || grant.principalId !== holder.id) return false;
  return grantMatchesPath(grant.path, objectPath);
}

function effectiveLabel(objectPath: string, labels: LabelRow[]): SensitivityLabel {
  let best: SensitivityLabel = 'internal';
  for (const row of labels) {
    if (grantMatchesPath(row.path, objectPath)) {
      if (LABEL_RANK[row.label] > LABEL_RANK[best]) best = row.label;
    }
  }
  return best;
}

/** Highest sensitivity label on the path (catalog → schema → table). */
export function effectiveLabelForPath(policy: PolicySnapshot, objectPath: string): SensitivityLabel {
  return effectiveLabel(normalizePath(objectPath), policy.labels);
}

function tierFromLabel(label: SensitivityLabel): DataTier {
  if (label === 'restricted') return 'restricted';
  if (label === 'confidential') return 'confidential';
  return 'internal';
}

function maxTier(a: DataTier, b: DataTier): DataTier {
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

function decideUser(
  user: DecideUserInput,
  objectPath: string,
  level: AccessLevel,
  policy: PolicySnapshot,
): Decision {
  const path = normalizePath(objectPath);
  const holders = holdersForUser(user.userId, user.departmentIds, user.roles);

  if (policy.legacyOpen) {
    const label = effectiveLabel(path, policy.labels);
    if (LABEL_RANK[user.clearance] < LABEL_RANK[label]) {
      return { allowed: false, reason: 'needs_clearance', label };
    }
    return { allowed: true, tier: tierFromLabel(label), reason: 'legacy_open' };
  }

  for (const chainPath of pathChain(path)) {
    for (const grant of policy.grants) {
      if (grant.effect !== 'deny') continue;
      for (const h of holders) {
        if (grantApplies(grant, h, chainPath)) {
          return { allowed: false, reason: 'explicit_deny' };
        }
      }
    }
  }

  let bestAllow: AccessLevel | null = null;
  for (const grant of policy.grants) {
    if (grant.effect !== 'allow') continue;
    for (const h of holders) {
      if (!grantApplies(grant, h, path)) continue;
      bestAllow = maxLevel(bestAllow, grant.level);
    }
  }

  if (!bestAllow || !levelAtLeast(bestAllow, level)) {
    return { allowed: false, reason: 'no_grant' };
  }

  const label = effectiveLabel(path, policy.labels);
  if (LABEL_RANK[user.clearance] < LABEL_RANK[label]) {
    return { allowed: false, reason: 'needs_clearance', label };
  }

  return { allowed: true, tier: tierFromLabel(label) };
}

export function decideObject(
  user: DecideUserInput,
  objectPath: string,
  level: AccessLevel,
  policy: PolicySnapshot,
): AccessDecision {
  const d = decideUser(user, objectPath, level, policy);
  if (!d.allowed) {
    return {
      decision: 'deny',
      reason: d.reason,
      tier: d.label === 'restricted' ? 'restricted' : d.label === 'confidential' ? 'confidential' : 'internal',
    };
  }
  return { decision: 'allow', tier: d.tier, reason: d.reason === 'legacy_open' ? 'legacy_open' : undefined };
}

export function decide(
  principal: AccessPrincipal,
  objectPath: string,
  level: AccessLevel,
  policy: PolicySnapshot,
): Decision {
  if (principal.kind === 'system') {
    return { allowed: true, tier: 'internal' };
  }
  return decideUser(
    {
      userId: principal.userId,
      departmentIds: principal.departmentIds,
      clearance: principal.clearance,
      roles: principal.roles,
    },
    objectPath,
    level,
    policy,
  );
}

export function visibleFailurePaths(
  principal: AccessPrincipal,
  paths: string[],
  level: AccessLevel,
  policy: PolicySnapshot,
): string[] {
  return paths.filter((p) => {
    const d = decide(principal, p, level, policy);
    return d.allowed || (d.allowed === false && d.reason !== 'needs_clearance');
  });
}

export function authorizePaths(
  principal: AccessPrincipal,
  paths: string[],
  level: AccessLevel,
  policy: PolicySnapshot,
): AuthorizePathsResult {
  const unique = [...new Set(paths.map((p) => normalizePath(p)).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: false, reason: 'no_grant', visiblePaths: [] };
  }

  let tier: DataTier = 'internal';
  const decisions = new Map<string, Decision>();

  for (const path of unique) {
    const decision = decide(principal, path, level, policy);
    decisions.set(path, decision);
    if (!decision.allowed) {
      return {
        ok: false,
        reason: decision.reason,
        failedPath: path,
        label: decision.label,
        visiblePaths: visibleFailurePaths(principal, unique, level, policy),
      };
    }
    tier = maxTier(tier, decision.tier);
  }

  return { ok: true, tier, decisions };
}

export function decidePaths(
  user: DecideUserInput,
  paths: string[],
  level: AccessLevel,
  policy: PolicySnapshot,
): { ok: true; tier: DataTier } | { ok: false; reason: string; reasonCode: DenyReason } {
  const principal: AccessPrincipal = {
    kind: 'user',
    orgId: policy.orgId,
    userId: user.userId,
    departmentIds: user.departmentIds,
    clearance: user.clearance,
    roles: user.roles,
  };
  const result = authorizePaths(principal, paths, level, policy);
  if (result.ok) return { ok: true, tier: result.tier };
  return {
    ok: false,
    reason: `Access denied (${result.reason})`,
    reasonCode: result.reason,
  };
}
