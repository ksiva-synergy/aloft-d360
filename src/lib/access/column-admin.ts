/**
 * Shared rules for the column access admin APIs: data tags, column tags, access groups and tag
 * grants (docs/access/pii-protection-backlog.md §7, epic E8).
 *
 * Who may do what:
 *   - View (Govern → Data access View): read tags, groups, column tags and grants.
 *   - Manage on Data access: create and edit tags and groups, tag columns (narrows access),
 *     remove tag grants (narrows access), archive groups.
 *   - Platform admin only (widens access to sensitive data): grant a tag to a group or a person,
 *     remove a tag from a column, archive a tag, turn off two approvals on a tag, change owners.
 *   - Group owner or platform admin: add a member to a group. Owner, platform admin, or Manage on
 *     Data access: remove a member.
 *   - Nobody adds themselves to a group or grants a tag to themselves.
 *   - Every change needs a reason and writes the audit log.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/http';
import { resolveAuth, type AuthContext } from '@/middleware/auth';
import { levelsForContext } from '@/lib/sections/server';
import { isPlatformAdminRole } from './sensitive';

export const ReasonSchema = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

const COLUMN_MAX = 255;
const TABLE_SEGMENT = /^[a-z0-9_-]+$/;

export function normalizeTagKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) {
    throw new ApiError(400, 'Key must start with a letter and use lowercase letters, digits, or underscores');
  }
  return key;
}

/** Column tags apply to tables only: `catalog.schema.table`, lowercase. */
export function normalizeTablePath(raw: string): string {
  const parts = raw.trim().toLowerCase().split('.').filter(Boolean);
  if (parts.length !== 3 || !parts.every((p) => TABLE_SEGMENT.test(p))) {
    throw new ApiError(400, 'Table path must be catalog.schema.table (lowercase letters, digits, underscores, hyphens)');
  }
  return parts.join('.');
}

export function normalizeColumnName(raw: string): string {
  const col = raw.trim();
  if (!col || col.length > COLUMN_MAX) {
    throw new ApiError(400, `Column name must be between 1 and ${COLUMN_MAX} characters`);
  }
  if (/[.\0\r\n]/.test(col)) {
    throw new ApiError(400, `Column "${raw}" is not a valid column name`);
  }
  return col.toLowerCase();
}

export function hasDataAccessManage(auth: AuthContext): boolean {
  return levelsForContext(auth)['govern.data-access'] === 'manage';
}

export async function assertActiveTag(orgId: string, tagId: string) {
  const tag = await prisma.accessTag.findFirst({ where: { id: tagId, org_id: orgId, archived_at: null } });
  if (!tag) throw new ApiError(404, 'Tag not found');
  return tag;
}

export async function assertActiveGroup(orgId: string, groupId: string) {
  const group = await prisma.accessGroup.findFirst({ where: { id: groupId, org_id: orgId, archived_at: null } });
  if (!group) throw new ApiError(404, 'Group not found');
  return group;
}

export async function isGroupOwner(groupId: string, userId: string): Promise<boolean> {
  const row = await prisma.accessGroupOwner.findUnique({
    where: { group_id_user_id: { group_id: groupId, user_id: userId } },
  });
  return !!row;
}

/**
 * Group membership changes. Adding (POST) needs the group's owner or a platform admin. Removing
 * (DELETE) also allows Manage on Data access, because removing only narrows access.
 */
export async function requireGroupMemberManager(req: Request, groupId: string): Promise<AuthContext> {
  const auth = await resolveAuth(req);
  if (isPlatformAdminRole(auth.role)) return auth;
  if (await isGroupOwner(groupId, auth.userId)) return auth;
  if (req.method === 'DELETE' && hasDataAccessManage(auth)) return auth;
  throw new ApiError(403, 'Only an owner of this group or a platform admin can change its members.');
}

export function serializeTag(
  t: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    requires_two_approvals: boolean;
    max_duration_days: number | null;
    archived_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
  counts?: { columns: number; grants: number },
) {
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    description: t.description,
    requiresTwoApprovals: t.requires_two_approvals,
    maxDurationDays: t.max_duration_days,
    archivedAt: t.archived_at?.toISOString() ?? null,
    columnCount: counts?.columns,
    grantCount: counts?.grants,
    createdAt: t.created_at.toISOString(),
    updatedAt: t.updated_at.toISOString(),
  };
}

export function serializeColumnTag(c: {
  id: string;
  table_path: string;
  column_name: string;
  tag_id: string;
  status: string;
  source: string;
  reason: string | null;
  set_by: string | null;
  updated_at: Date;
}) {
  return {
    id: c.id,
    tablePath: c.table_path,
    column: c.column_name,
    tagId: c.tag_id,
    status: c.status,
    source: c.source,
    reason: c.reason,
    setBy: c.set_by,
    updatedAt: c.updated_at.toISOString(),
  };
}

export function serializeTagGrant(g: {
  id: string;
  tag_id: string;
  principal_type: string;
  principal_id: string;
  level: string;
  expires_at: Date | null;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
}) {
  return {
    id: g.id,
    tagId: g.tag_id,
    principalType: g.principal_type,
    principalId: g.principal_id,
    level: g.level,
    expiresAt: g.expires_at?.toISOString() ?? null,
    reason: g.reason,
    createdBy: g.created_by,
    createdAt: g.created_at.toISOString(),
  };
}

export type PersonRef = { id: string; email: string; name: string | null };

export async function peopleById(ids: string[]): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/** An end date must be in the future. */
export function parseExpiry(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'End date is not a valid date');
  if (d.getTime() <= Date.now()) throw new ApiError(400, 'End date must be in the future');
  return d;
}
