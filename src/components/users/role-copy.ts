/** Human-readable role labels and help text for invite / change-role UI. */

export const ROLE_ORDER = ['platform_admin', 'admin', 'member', 'readonly'] as const;

export type PlatformRoleName = (typeof ROLE_ORDER)[number];

export type RoleCopy = {
  label: string;
  /** One line in the dropdown list */
  summary: string;
  /** Shown under the dropdown for the current selection */
  detail: string;
};

export const ROLE_COPY: Record<PlatformRoleName, RoleCopy> = {
  platform_admin: {
    label: 'Platform admin',
    summary: 'Full access — all users’ data and settings',
    detail:
      'Same view as platform owners: all agents, connections, sessions, and user management. Choose this when someone needs to see and manage everyone’s work (for example after re-inviting a removed user).',
  },
  admin: {
    label: 'Admin',
    summary: 'All features — only their own data',
    detail:
      'Can use the full product, but agents, chats, and connections are scoped to their account. They cannot see other people’s sessions or org-wide staging data.',
  },
  member: {
    label: 'Member',
    summary: 'Ask Data plus read-only elsewhere',
    detail:
      'Full Ask Data access. Other areas are read-only—enough to explore, not to change configuration or run admin actions.',
  },
  readonly: {
    label: 'Read only',
    summary: 'Sign in and view — no edits',
    detail:
      'Can log in and browse allowed screens. Cannot create or change content, run agents, or manage users.',
  },
};

export function roleCopy(name: string): RoleCopy {
  return ROLE_COPY[name as PlatformRoleName] ?? ROLE_COPY.readonly;
}
