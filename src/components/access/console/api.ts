export type Level = 'discover' | 'query' | 'export';
export type Sensitivity = 'internal' | 'confidential' | 'restricted';
export type DenyReason =
  | 'explicit_deny'
  | 'no_grant'
  | 'needs_clearance'
  | 'legacy_open'
  | 'sql_unresolved'
  | 'system_scope';

export type Department = { id: string; key: string; name: string; memberCount?: number };

export type Person = {
  id: string;
  email: string;
  name: string | null;
  status?: string;
  departmentIds: string[];
  clearance: Sensitivity;
  directGrants: number;
  /** Primary app role. */
  role: string;
  platformAdmin: boolean;
};

export type Grant = {
  id: string;
  principalType: 'user' | HolderType;
  principalId: string;
  path: string;
  level: Level;
  effect: 'allow' | 'deny';
  reason: string | null;
  createdAt: string;
};

export type GrantRef = {
  path: string;
  principalType: 'user' | HolderType;
  principalId: string;
  level: Level;
  effect: 'allow' | 'deny';
};

export type LabelSource = {
  label: Sensitivity;
  from: string | null;
  own: 'confidential' | 'restricted' | null;
};

export type DepartmentNodeAccess = {
  direct: Level | null;
  directDeny: boolean;
  inherited: Level | null;
  inheritedFrom: string | null;
  blockedBy: string | null;
  grantsInside: number;
};

export type HolderType = 'department' | 'role';

/** A department or app role that can hold data grants. */
export type Holder = {
  type: HolderType;
  id: string;
  name: string;
  sub: string;
};

export type RoleInfo = { name: string; label: string; people: number; rank: number };

export type PathTag = {
  principalType: HolderType;
  principalId: string;
  level: Level | null;
  deny: boolean;
  from: string | null;
  direct: boolean;
  inside: number;
};

export type UserPathExplanation = {
  path: string;
  legacyOpen: boolean;
  clearance: Sensitivity;
  label: LabelSource;
  deny: GrantRef | null;
  allow: GrantRef | null;
  grantedLevel: Level | null;
  allowedLevel: Level | null;
  reason: DenyReason | null;
};

export type TreeNode = {
  path: string;
  name: string;
  depth: 1 | 2 | 3;
  kind: 'catalog' | 'schema' | 'table' | 'view';
  childCount: number | null;
  tableCount: number | null;
  inEstate: boolean;
  label: LabelSource;
  /** Grant state for the department or role the tree is scoped to. */
  holder?: DepartmentNodeAccess;
  tags?: PathTag[];
  access?: UserPathExplanation;
  /** Allow grants this person holds below the node (catalog and schema rows). */
  accessInside?: number;
  /** This person's own grant on exactly this path (person view). */
  userDirect?: Level | 'deny' | null;
};

export type TreeResponse = {
  parent: string | null;
  legacyOpen: boolean;
  truncated: boolean;
  nodes: TreeNode[];
};

export type AccessStatus = {
  me: { userId: string; platformAdmin: boolean };
  roles: RoleInfo[];
  accessMode: 'off' | 'observe' | 'enforce';
  enforcedSurfaces: string[];
  legacyOpen: boolean;
  policyVersion: string;
  counts: {
    departments: number;
    people: number;
    peopleInDepartments: number;
    grants: number;
    departmentGrants: number;
    directGrants: number;
    denies: number;
    labels: number;
    clearances: number;
    decisions7d: number;
    denies7d: number;
  };
};

export class AccessApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function accessFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = json as { error?: string; details?: { required?: string; section?: string } };
    // Section access refusals carry their own plain message ("You can view Data access but not change it.").
    if (res.status === 403 && body.details?.section && body.error) throw new AccessApiError(body.error, 403);
    if (res.status === 403 && body.details?.required) {
      throw new AccessApiError(
        `This needs the ${body.details.required} permission (or the Admin app role).`,
        403,
      );
    }
    throw new AccessApiError(body.error ?? res.statusText, res.status);
  }
  return json as T;
}

/**
 * Start an async loader from an effect. The loader sets state only after its request
 * returns, so the effect body itself never sets state synchronously.
 */
export function runAsync(fn: () => Promise<unknown>): void {
  void Promise.resolve().then(fn);
}

export function send<T = unknown>(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  return accessFetch<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Departments and mappable app roles as one list (roles first). */
export function buildHolders(departments: Department[], roles: RoleInfo[]): Holder[] {
  return [
    ...roles.map((r) => ({
      type: 'role' as const,
      id: r.name,
      name: r.label,
      sub: `App role · ${r.people} people`,
    })),
    ...departments.map((d) => ({
      type: 'department' as const,
      id: d.id,
      name: d.name,
      sub: `Department · ${d.memberCount ?? 0} people`,
    })),
  ];
}

export function holderKey(type: HolderType, id: string): string {
  return `${type}:${id}`;
}

export function personName(p: { name: string | null; email: string } | undefined, fallback = 'Unknown'): string {
  if (!p) return fallback;
  return p.name?.trim() || p.email;
}

export const LEVEL_LABEL: Record<Level, string> = {
  discover: 'Discover',
  query: 'Query',
  export: 'Export',
};

export const LEVEL_HINT: Record<Level, string> = {
  discover: 'See names, columns, descriptions',
  query: 'Read rows, charts, dashboards',
  export: 'Download results as CSV',
};

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  internal: 'Internal',
  confidential: 'Confidential',
  restricted: 'Restricted',
};

export function reasonText(reason: DenyReason | null, label?: Sensitivity): string {
  switch (reason) {
    case 'no_grant':
      return 'No grant';
    case 'needs_clearance':
      return label && label !== 'internal' ? `Needs ${SENSITIVITY_LABEL[label]} clearance` : 'Needs clearance';
    case 'explicit_deny':
      return 'Blocked';
    case 'legacy_open':
      return 'Open (no grants yet)';
    case 'sql_unresolved':
      return 'SQL tables not readable';
    case 'system_scope':
      return 'Outside system scope';
    default:
      return '—';
  }
}

// ── Column access: data tags, access groups, tag grants (pii-protection-backlog.md §7) ──

export type TagLevel = 'aggregate' | 'full';

export const TAG_LEVEL_LABEL: Record<TagLevel, string> = { aggregate: 'Totals only', full: 'Full' };
export const TAG_LEVEL_HINT: Record<TagLevel, string> = {
  aggregate: 'Averages and totals for groups of 5 or more; no individual values',
  full: 'Real values',
};

export type DataTag = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  requiresTwoApprovals: boolean;
  maxDurationDays: number | null;
  columnCount?: number;
  grantCount?: number;
};

export type ColumnTagRow = {
  id: string;
  tablePath: string;
  column: string;
  tagId: string;
  status: string;
  source: string;
  reason: string | null;
  setBy: string | null;
  updatedAt: string;
};

export type TagGrant = {
  id: string;
  tagId: string;
  principalType: 'group' | 'user';
  principalId: string;
  level: TagLevel;
  expiresAt: string | null;
  reason: string | null;
  createdAt: string;
};

export type GroupPerson = { userId: string; email: string | null; name: string | null };

export type GroupMember = GroupPerson & {
  expiresAt: string | null;
  expired: boolean;
  reason: string | null;
  addedAt: string;
};

export type AccessGroup = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  owners: GroupPerson[];
  members: GroupMember[];
  grants: TagGrant[];
};

/** "Payroll team" → "payroll_team" (keys must start with a letter). */
export function keyFromName(name: string): string {
  const k = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(k) ? k.slice(0, 64) : `t_${k}`.slice(0, 64);
}
