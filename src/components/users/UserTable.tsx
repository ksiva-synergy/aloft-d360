'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  MoreHorizontal, Pencil, Shield, UserX, Trash2, User, Clock, Ban,
  MessagesSquare, Brain,
} from 'lucide-react';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'DEACTIVATED';
  authProvider: string;
  aadObjectId?: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  primaryRole: string;
  roleLabel: string;
  roles: { role: { name: string } }[];
  // Engagement metrics (aggregated server-side; default 0 when absent)
  logins7d?: number;
  logins30d?: number;
  sessions7d?: number;
  sessions30d?: number;
  inspectorChats?: number;
  memoriesContributed?: number;
}

interface UserTableProps {
  users: UserRow[];
  loading?: boolean;
  currentUserId?: string;
  canAssignRoles?: boolean;
  canUpdateUsers?: boolean;
  canDeleteUsers?: boolean;
  onRowClick?: (user: UserRow) => void;
  onChangeRole?: (user: UserRow) => void;
  onEditUser?: (user: UserRow) => void;
  onToggleStatus?: (user: UserRow) => void;
  onDeleteUser?: (user: UserRow) => void;
}

// Role chips sourced from the Spinor Labs brand palette (gold / navy / slate)
// so they read consistently in both themes — see globals.css --estate-* tokens.
const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin: 'text-[var(--brand-a-ink)] dark:text-[var(--brand-a-ink)] bg-[color-mix(in_srgb,var(--brand-a)_10%,transparent)] border-[color-mix(in_srgb,var(--brand-a)_30%,transparent)]',
  admin:          'text-[var(--brand-a-ink)] dark:text-[#5B9DFF] bg-[var(--brand-a-ink)]/[0.07] dark:bg-[#5B9DFF]/10 border-[color-mix(in_srgb,var(--brand-a-ink)_20%,transparent)] dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[var(--ink-3)] bg-[color-mix(in_srgb,var(--ink-3)_10%,transparent)] border-[color-mix(in_srgb,var(--ink-3)_25%,transparent)]',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[color-mix(in_srgb,var(--ink-3)_25%,transparent)]',
};

const STATUS_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  ACTIVE:      { dot: 'bg-emerald-500',  text: 'text-emerald-600 dark:text-emerald-400', label: 'Active' },
  SUSPENDED:   { dot: 'bg-red-500',      text: 'text-red-600 dark:text-red-400',         label: 'Blocked' },
  INVITED:     { dot: 'bg-blue-400',     text: 'text-blue-600 dark:text-blue-400',        label: 'Invited' },
  DEACTIVATED: { dot: 'bg-[color:var(--line-2)]',    text: 'text-[var(--ink-3)] dark:text-[color:var(--ink-3)]',      label: 'Deactivated' },
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatJoinDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RoleBadge({ role, label }: { role: string; label: string }) {
  const style = ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly;
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded border px-[7px] py-px',
        'font-mono text-xs font-semibold uppercase leading-[1.6] tracking-wide',
        style,
      )}
    >
      {label}
    </span>
  );
}

/** Compact 30d / 7d metric for the activity column. */
function MetricChip({
  label,
  d30,
  d7,
  title,
}: {
  label: string;
  d30: number;
  d7: number;
  title: string;
}) {
  const active = d30 > 0 || d7 > 0;
  return (
    <div
      title={title}
      className={cn(
        'min-w-[4.5rem] rounded-md border px-2 py-1.5',
        active
          ? 'border-[color-mix(in_srgb,var(--brand-a)_22%,transparent)] bg-[color-mix(in_srgb,var(--brand-a)_6%,transparent)]'
          : 'border-[var(--estate-border)] bg-[var(--estate-hover)]/50',
      )}
    >
      <div className="font-mono text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--estate-text-dim)]">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
        <span className={cn('text-sm font-semibold leading-none', active ? 'text-[var(--estate-ink)]' : 'text-muted-foreground/40')}>
          {d30}
        </span>
        <span className="text-[length:var(--type-caption-size)] text-muted-foreground">/ {d7}·7d</span>
      </div>
    </div>
  );
}

function ActivityCell({ user }: { user: UserRow }) {
  const l30 = user.logins30d ?? 0;
  const l7 = user.logins7d ?? 0;
  const s30 = user.sessions30d ?? 0;
  const s7 = user.sessions7d ?? 0;
  const insp = user.inspectorChats ?? 0;
  const mem = user.memoriesContributed ?? 0;
  return (
    <div className="flex items-center gap-1.5">
      <MetricChip label="Logins" d30={l30} d7={l7} title={`${l30} sign-ins (30d) · ${l7} (7d)`} />
      <MetricChip label="Sessions" d30={s30} d7={s7} title={`${s30} workbench sessions (30d) · ${s7} (7d)`} />
      {(insp > 0 || mem > 0) && (
        <div className="flex flex-col gap-0.5 pl-1" title={`${insp} inspector chats · ${mem} memories`}>
          {insp > 0 && (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption-size)] text-muted-foreground">
              <MessagesSquare className="h-3 w-3 shrink-0 opacity-70" />
              <span className="tabular-nums font-medium text-[var(--foreground)]">{insp}</span>
            </span>
          )}
          {mem > 0 && (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption-size)] text-muted-foreground">
              <Brain className="h-3 w-3 shrink-0 opacity-70" />
              <span className="tabular-nums font-medium text-[var(--foreground)]">{mem}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const TH =
  'text-left px-4 py-3 font-mono text-[length:var(--type-caption-size)] uppercase tracking-wide font-semibold text-[var(--estate-text-dim)] whitespace-nowrap';

function ProviderBadge({ provider }: { provider: string }) {
  const isAad = provider === 'aad';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 font-mono text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide',
        isAad
          ? 'border-[color-mix(in_srgb,var(--brand-a)_25%,transparent)] bg-[color-mix(in_srgb,var(--brand-a)_8%,transparent)] text-[var(--brand-a-ink)]'
          : 'border-[var(--estate-border)] bg-[var(--estate-hover)] text-muted-foreground',
      )}
    >
      {isAad ? 'Entra ID' : provider === 'credentials' ? 'Password' : provider}
    </span>
  );
}

function ActionsMenu({
  user,
  currentUserId,
  canAssignRoles,
  canUpdateUsers,
  canDeleteUsers,
  onChangeRole,
  onEditUser,
  onToggleStatus,
  onDeleteUser,
}: {
  user: UserRow;
  currentUserId?: string;
  canAssignRoles?: boolean;
  canUpdateUsers?: boolean;
  canDeleteUsers?: boolean;
  onChangeRole?: (u: UserRow) => void;
  onEditUser?: (u: UserRow) => void;
  onToggleStatus?: (u: UserRow) => void;
  onDeleteUser?: (u: UserRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isSelf = user.id === currentUserId;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const hasActions = canAssignRoles || canUpdateUsers || canDeleteUsers;
  if (!hasActions) return null;

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--estate-hover)] transition-colors"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--estate-surface)] border border-[var(--estate-border)] rounded-lg shadow-lg overflow-hidden z-50">
          {canUpdateUsers && (
            <button
              onClick={() => { setOpen(false); onEditUser?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Edit Profile
            </button>
          )}
          {canAssignRoles && (
            <button
              onClick={() => { setOpen(false); onChangeRole?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              Change Role
            </button>
          )}
          {canUpdateUsers && !isSelf && (
            <button
              onClick={() => { setOpen(false); onToggleStatus?.(user); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors',
                user.status === 'SUSPENDED'
                  ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                  : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
              )}
            >
              {user.status === 'SUSPENDED'
                ? <><UserX className="h-3.5 w-3.5" />Unblock User</>
                : <><Ban className="h-3.5 w-3.5" />Block User</>
              }
            </button>
          )}
          {canDeleteUsers && !isSelf && (
            <button
              onClick={() => { setOpen(false); onDeleteUser?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)] hover:bg-[var(--estate-hover)] transition-colors border-t border-[var(--estate-border)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove User
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--estate-border)] animate-pulse">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[color:var(--surface-3)] dark:bg-[color:var(--surface-3)] shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3 w-28 bg-[color:var(--surface-3)] dark:bg-[color:var(--surface-3)] rounded" />
            <div className="h-2.5 w-36 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-[color:var(--surface-3)] dark:bg-[color:var(--surface-3)] rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-14 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 bg-[color:var(--surface-2)] dark:bg-[color:var(--surface-2)] rounded" /></td>
      <td className="px-4 py-3" />
    </tr>
  );
}

export function UserTable({
  users,
  loading,
  currentUserId,
  canAssignRoles,
  canUpdateUsers,
  canDeleteUsers,
  onRowClick,
  onChangeRole,
  onEditUser,
  onToggleStatus,
  onDeleteUser,
}: UserTableProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1024px] text-sm">
          <thead>
            <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)]">
              <th className={TH}>User</th>
              <th className={TH}>Role</th>
              <th className={TH}>Status</th>
              <th className={TH}>Provider</th>
              <th className={TH}>Last login</th>
              <th className={TH}>Joined</th>
              <th className={TH}>Activity (30d)</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </tbody>
        </table>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden shadow-sm">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <User className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No users found</p>
          <p className="text-xs mt-1 opacity-75">Adjust your search or filters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[1024px] text-sm">
        <thead>
          <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)]">
            <th className={cn(TH, 'min-w-[220px]')}>User</th>
            <th className={TH}>Role</th>
            <th className={TH}>Status</th>
            <th className={TH}>Provider</th>
            <th className={TH}>Last login</th>
            <th className={TH}>Joined</th>
            <th className={cn(TH, 'min-w-[200px]')}>Activity (30d)</th>
            <th className="px-4 py-3 w-10" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.DEACTIVATED;
            const initials = getInitials(user.name, user.email);
            const isSelf = user.id === currentUserId;

            return (
              <tr
                key={user.id}
                onClick={() => onRowClick?.(user)}
                className={cn(
                  'border-b border-[var(--estate-border)] last:border-b-0 transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-[var(--estate-hover)]' : '',
                  isSelf && 'bg-[color-mix(in_srgb,var(--brand-a)_4%,transparent)]',
                )}
              >
                {/* User column */}
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-[length:var(--type-caption-size)] font-semibold ring-1 ring-[color-mix(in_srgb,var(--brand-a)_28%,transparent)]"
                      style={{
                        background: 'color-mix(in srgb, var(--brand-a) 16%, transparent)',
                        color: 'var(--brand-a-ink)',
                      }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 max-w-[240px]">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
                        <span className="truncate">
                          {user.name || <span className="italic text-muted-foreground font-normal">No name</span>}
                        </span>
                        {isSelf && (
                          <span className="shrink-0 rounded px-1.5 py-px font-mono text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--brand-a-ink)] bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)]">
                            you
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                </td>

                {/* Role column */}
                <td className="px-4 py-3">
                  <RoleBadge role={user.primaryRole} label={user.roleLabel} />
                </td>

                {/* Status column */}
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center gap-1.5 text-xs', status.text)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', status.dot)} />
                    {status.label}
                  </span>
                </td>

                {/* Provider column */}
                <td className="px-4 py-3.5">
                  <ProviderBadge provider={user.authProvider} />
                </td>

                {/* Last Login column */}
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-xs text-[var(--estate-ink)]">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {formatRelative(user.lastLoginAt)}
                  </span>
                </td>

                {/* Joined column */}
                <td className="px-4 py-3.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatJoinDate(user.createdAt)}
                </td>

                {/* Activity column */}
                <td className="px-4 py-3">
                  <ActivityCell user={user} />
                </td>

                {/* Actions column */}
                <td className="px-4 py-3 text-right">
                  <ActionsMenu
                    user={user}
                    currentUserId={currentUserId}
                    canAssignRoles={canAssignRoles}
                    canUpdateUsers={canUpdateUsers}
                    canDeleteUsers={canDeleteUsers}
                    onChangeRole={onChangeRole}
                    onEditUser={onEditUser}
                    onToggleStatus={onToggleStatus}
                    onDeleteUser={onDeleteUser}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
