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
  | 'system_scope'
  /** A protected column is used to filter, sort, group or join. */
  | 'column_refused'
  /** The query reads protected data but its columns could not be resolved. */
  | 'column_unresolved';

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

/** How much of a tag a grant opens: aggregates only (groups of 5 or more), or real values. */
export type TagGrantLevel = 'aggregate' | 'full';

export interface TagInfo {
  id: string;
  key: string;
  /** Friendly name used in messages, e.g. "Compensation". */
  name: string;
  requiresTwoApprovals: boolean;
}

export interface TagGrantRow {
  tagId: string;
  principalType: 'group' | 'user';
  principalId: string;
  level: TagGrantLevel;
  expiresAt: Date | null;
}

export interface GroupMembershipRow {
  groupId: string;
  expiresAt: Date | null;
}

/** Column access by tag and group (pii-protection-backlog.md §7). Confirmed tags only. */
export interface ColumnPolicy {
  /** Active (not archived) tags by id. */
  tags: Map<string, TagInfo>;
  /** lowercase table path → lowercase column name → tag ids. */
  columnTags: Map<string, Map<string, string[]>>;
  tagGrants: TagGrantRow[];
  /** userId → access group memberships (active groups only). */
  groupsByUser: Map<string, GroupMembershipRow[]>;
}

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
  /** Column tags, tag grants and access groups. Empty until the 20261107 migration is applied. */
  columns?: ColumnPolicy;
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
