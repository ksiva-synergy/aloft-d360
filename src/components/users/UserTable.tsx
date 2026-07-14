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
  platform_admin: 'text-[#8a6a12] dark:text-[#FDB515] bg-[#FDB515]/10 border-[#FDB515]/30',
  admin:          'text-[#003262] dark:text-[#5B9DFF] bg-[#003262]/[0.07] dark:bg-[#5B9DFF]/10 border-[#003262]/20 dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[#8892A4] bg-[#8892A4]/10 border-[#8892A4]/25',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[#8892A4]/25',
};

const STATUS_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  ACTIVE:      { dot: 'bg-emerald-500',  text: 'text-emerald-600 dark:text-emerald-400', label: 'Active' },
  SUSPENDED:   { dot: 'bg-red-500',      text: 'text-red-600 dark:text-red-400',         label: 'Blocked' },
  INVITED:     { dot: 'bg-blue-400',     text: 'text-blue-600 dark:text-blue-400',        label: 'Invited' },
  DEACTIVATED: { dot: 'bg-slate-400',    text: 'text-slate-500 dark:text-slate-400',      label: 'Deactivated' },
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RoleBadge({ role, label }: { role: string; label: string }) {
  const style = ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.readonly;
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded border px-[7px] py-px',
        'font-mono text-[10px] font-semibold uppercase leading-[1.6] tracking-[0.05em]',
        style,
      )}
    >
      {label}
    </span>
  );
}

/** A "30d / 7d" pair under a tiny label — the 7d figure is dimmed as secondary. */
function PairStat({ d30, d7, label, title }: { d30: number; d7: number; label: string; title?: string }) {
  return (
    <div className="flex flex-col items-start leading-none" title={title}>
      <span className="tabular-nums">
        <span className={cn('text-[12.5px] font-semibold', d30 > 0 ? 'text-[var(--foreground)]' : 'text-muted-foreground/50')}>{d30}</span>
        <span className="text-[11px] text-muted-foreground/70"> / {d7}</span>
      </span>
      <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
        {label} <span className="opacity-60">30d/7d</span>
      </span>
    </div>
  );
}

/** An icon + count for all-time totals (inspector chats, memories). */
function IconStat({ icon: Icon, value, title }: { icon: React.ElementType; value: number; title: string }) {
  return (
    <div className="flex items-center gap-1" title={title}>
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground opacity-60" />
      <span className={cn('text-[12px] tabular-nums font-medium', value > 0 ? 'text-[var(--foreground)]' : 'text-muted-foreground/50')}>{value}</span>
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
    <div className="flex items-center gap-3">
      <PairStat d30={l30} d7={l7} label="Logins" title={`${l30} logins in 30d · ${l7} in 7d`} />
      <PairStat d30={s30} d7={s7} label="WB" title={`${s30} workbench sessions in 30d · ${s7} in 7d`} />
      <span className="h-6 w-px bg-[var(--estate-border)]" aria-hidden />
      <IconStat icon={MessagesSquare} value={insp} title={`${insp} inspector chats`} />
      <IconStat icon={Brain} value={mem} title={`${mem} memories contributed`} />
    </div>
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
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              Edit Profile
            </button>
          )}
          {canAssignRoles && (
            <button
              onClick={() => { setOpen(false); onChangeRole?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              Change Role
            </button>
          )}
          {canUpdateUsers && !isSelf && (
            <button
              onClick={() => { setOpen(false); onToggleStatus?.(user); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-[12px] transition-colors',
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
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-slate-600 dark:text-slate-400 hover:bg-[var(--estate-hover)] transition-colors border-t border-[var(--estate-border)]"
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
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="h-2.5 w-36 bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 bg-slate-100 dark:bg-slate-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-14 bg-slate-100 dark:bg-slate-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-slate-100 dark:bg-slate-800 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded" /></td>
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
      <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)]">
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">User</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Role</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Status</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Provider</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Last Login</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Joined</th>
              <th className="text-left px-4 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] font-medium text-[var(--estate-text-dim)]">Activity</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </tbody>
        </table>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <User className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No users found</p>
          <p className="text-xs mt-1 opacity-75">Adjust your search or filters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)]">
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">User</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Role</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Status</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Provider</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Last Login</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Joined</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Activity</th>
            <th className="px-4 py-2.5" />
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
                )}
              >
                {/* User column */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 select-none"
                      style={{ background: '#003262', color: '#FDB515' }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[var(--foreground)] truncate max-w-[180px]">
                        {user.name || <span className="italic text-muted-foreground">No name</span>}
                        {isSelf && (
                          <span className="ml-1.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-[#FDB515] opacity-80">you</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[180px] font-mono">{user.email}</div>
                    </div>
                  </div>
                </td>

                {/* Role column */}
                <td className="px-4 py-3">
                  <RoleBadge role={user.primaryRole} label={user.roleLabel} />
                </td>

                {/* Status column */}
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center gap-1.5 text-[11.5px]', status.text)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', status.dot)} />
                    {status.label}
                  </span>
                </td>

                {/* Provider column */}
                <td className="px-4 py-3">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {user.authProvider === 'aad' ? 'Entra ID' : user.authProvider === 'credentials' ? 'Password' : user.authProvider}
                  </span>
                </td>

                {/* Last Login column */}
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0 opacity-60" />
                    {formatDate(user.lastLoginAt)}
                  </span>
                </td>

                {/* Joined column */}
                <td className="px-4 py-3 text-[11.5px] text-muted-foreground">
                  {formatDate(user.createdAt)}
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
  );
}
