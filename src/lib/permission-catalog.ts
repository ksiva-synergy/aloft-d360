/**
 * Every permission a role can carry, in plain words, for Users → Permissions. Pure module, safe on
 * client and server.
 *
 * Permissions sit beside section access (src/lib/sections/registry.ts): a section decides which
 * screens a person can open; a permission is a finer right some routes check on top (for example
 * `inspector:use` to ask questions, or `connector:external` to publish a flow that sends email).
 *
 * Keys must match PERMISSIONS in src/lib/rbac.ts, CAPABILITY_PERMISSIONS in
 * src/lib/capabilities/builtin.ts and RAW_SQL_PERMISSION in src/lib/flows/policy.ts (a test checks).
 *
 *   checked            — false when no route checks the key today (the screen uses section access
 *                        instead). Shown in the UI so a tick never pretends to do something.
 *   platformAdminOnly  — never given to another role here (cross-user data). Platform admins hold
 *                        every permission anyway.
 */

export type PermissionGroup = 'ask' | 'automate' | 'history' | 'people' | 'data' | 'audit';

export interface PermissionInfo {
  key: string;
  label: string;
  description: string;
  group: PermissionGroup;
  checked: boolean;
  platformAdminOnly?: boolean;
  /** Shown as a warning next to the tick. */
  sensitive?: boolean;
}

export const PERMISSION_GROUP_LABEL: Record<PermissionGroup, string> = {
  ask: 'Ask Data and agents',
  automate: 'Automate publishing',
  history: 'Sessions and history',
  people: 'People and roles',
  data: 'Data access',
  audit: 'Audit',
};

export const PERMISSION_CATALOG: readonly PermissionInfo[] = [
  {
    key: 'inspector:use',
    label: 'Use Ask Data, agents, Knowledge and Automate',
    description: 'Ask questions, chat with agents, use knowledge bases and build flows. The section must also be open to them.',
    group: 'ask',
    checked: true,
  },
  {
    key: 'connector:write',
    label: 'Publish flows that write through a connection',
    description: 'Flow steps that change data in another system (REST writes, uploads).',
    group: 'automate',
    checked: true,
  },
  {
    key: 'connector:external',
    label: 'Publish flows that send outside ALOFT',
    description: 'Flow steps that send email or messages to people.',
    group: 'automate',
    checked: true,
  },
  {
    key: 'flow:sql',
    label: 'Publish flows with raw SQL steps',
    description: 'Flow steps that run SQL written by hand instead of a saved query.',
    group: 'automate',
    checked: true,
  },
  { key: 'session:read', label: 'See their own sessions', description: 'Open their own Ask Data sessions and actions.', group: 'history', checked: true },
  { key: 'session:write', label: 'Save sessions', description: 'Create and update their own sessions and actions.', group: 'history', checked: true },
  {
    key: 'session:read:all',
    label: "See everyone's sessions and history",
    description: "Read other people's sessions, chats and runs.",
    group: 'history',
    checked: true,
    platformAdminOnly: true,
  },
  {
    key: 'user:read',
    label: 'See org-wide activity on Home',
    description: 'The Home overview shows sign-ins and activity across everyone, not just their own.',
    group: 'people',
    checked: true,
  },
  { key: 'user:create', label: 'Invite people', description: 'Not checked yet: inviting is decided by Users section access (Manage).', group: 'people', checked: false },
  { key: 'user:update', label: 'Change people', description: 'Not checked yet: decided by Users section access (Manage).', group: 'people', checked: false },
  { key: 'user:delete', label: 'Remove people', description: 'Not checked yet: decided by Users section access (Manage).', group: 'people', checked: false },
  { key: 'role:read', label: 'See data access roles and permissions', description: 'List data access roles and the permission list.', group: 'people', checked: true },
  { key: 'role:assign', label: 'Assign data access roles', description: 'Create data access roles and give them to people.', group: 'people', checked: true },
  {
    key: 'access:admin',
    label: 'Run SQL on a Databricks connection',
    description: 'Run a query on a Databricks connection from its settings. Departments, grants and labels use Data access section access.',
    group: 'data',
    checked: true,
  },
  { key: 'access:classify', label: 'Classify data', description: 'Not checked yet: labels use Data access section access (Manage).', group: 'data', checked: false },
  { key: 'access:audit', label: 'Read data access logs', description: 'Read the data access change and decision logs.', group: 'data', checked: true },
  { key: 'audit:read', label: 'Read the audit trail', description: 'Not checked yet: the Audit log uses section access.', group: 'audit', checked: false },
  {
    key: 'llm:payload:read',
    label: 'Read raw model prompts and replies',
    description: 'Not checked yet. Prompts can contain other people’s questions and data.',
    group: 'audit',
    checked: false,
    sensitive: true,
  },
];

export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionInfo> = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]));

/** Keys a platform admin may give to or take from a role in the UI. */
export const EDITABLE_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.filter((p) => !p.platformAdminOnly).map((p) => p.key),
);

/**
 * What to add and remove so a role holds exactly `requested` among the editable keys. Keys outside
 * the editable set (section keys, platform-admin-only keys, anything unknown) are never touched.
 */
export function planPermissionChange(current: Iterable<string>, requested: Iterable<string>): { add: string[]; remove: string[] } {
  const have = new Set([...current].filter((k) => EDITABLE_PERMISSION_KEYS.has(k)));
  const want = new Set([...requested].filter((k) => EDITABLE_PERMISSION_KEYS.has(k)));
  return {
    add: [...want].filter((k) => !have.has(k)).sort(),
    remove: [...have].filter((k) => !want.has(k)).sort(),
  };
}
