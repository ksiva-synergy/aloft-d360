import type { DataTier } from '@/lib/databricks/sp-roles';

export type { DataTier };

export type AccessMode = 'off' | 'observe' | 'enforce';

/** Requested capability on an object (discover / query / export). */
export type Level = 'discover' | 'query' | 'export';
export type AccessLevel = Level;

export type SensitivityLabel = 'internal' | 'confidential' | 'restricted';
export type Label = SensitivityLabel;

export type AccessDecisionKind = 'allow' | 'deny';

export type DenyReason =
  | 'explicit_deny'
  | 'no_grant'
  | 'needs_clearance'
  | 'legacy_open'
  | 'sql_unresolved'
  | 'system_scope';

/** Result of pure §4.1 decision for one path. */
export type Decision =
  | { allowed: true; tier: DataTier; reason?: 'legacy_open' }
  | { allowed: false; reason: DenyReason; label?: SensitivityLabel };

export interface AccessDecision {
  decision: AccessDecisionKind;
  reason?: DenyReason;
  tier: DataTier;
}

export interface UserAccessPrincipal {
  kind: 'user';
  orgId: string;
  userId: string;
  departmentIds: string[];
  clearance: SensitivityLabel;
  /** App roles whose data grants apply (held roles plus lower built-in roles). */
  roles?: string[];
}

export type AccessPrincipal =
  | UserAccessPrincipal
  | {
      kind: 'system';
      orgId: string;
      systemKind: 'harvest' | 'knowledge-sync' | 'benchmark' | 'health';
    };

export type AccessSurface =
  | 'sql'
  | 'semantic'
  | 'dashboard'
  | 'export'
  | 'describe'
  | 'estate';

/** Who a grant is for: one person, a department, or an app role (member, admin, ...). */
export type GrantPrincipalType = 'user' | 'department' | 'role';

export interface GrantRow {
  principalType: GrantPrincipalType;
  principalId: string;
  path: string;
  pathDepth: 1 | 2 | 3;
  level: AccessLevel;
  effect: 'allow' | 'deny';
  expiresAt: Date | null;
}

export type PolicyGrant = GrantRow;

export interface LabelRow {
  path: string;
  pathDepth?: 1 | 2 | 3;
  label: 'confidential' | 'restricted';
}

export type PolicyLabel = LabelRow;

export interface PolicySnapshot {
  orgId: string;
  version: bigint;
  grants: GrantRow[];
  labels: LabelRow[];
  /** userId → clearance (confidential / restricted only in map). */
  clearances: Map<string, SensitivityLabel>;
  /** userId → department ids */
  membersByUser: Map<string, string[]>;
  /** True when access_grants has zero rows for the org (bootstrap). */
  legacyOpen: boolean;
}

export interface AuthorizeContext {
  surface: AccessSurface;
  sessionId?: string | null;
  purpose?: string;
}

export type AuthorizePathsResult =
  | { ok: true; tier: DataTier; decisions: Map<string, Decision> }
  | {
      ok: false;
      reason: DenyReason;
      failedPath?: string;
      label?: SensitivityLabel;
      visiblePaths: string[];
    };

export interface DecideUserInput {
  userId: string;
  departmentIds: string[];
  clearance: SensitivityLabel;
  roles?: string[];
}
