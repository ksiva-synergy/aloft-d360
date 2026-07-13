'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  MoreHorizontal, Pencil, Shield, UserX, Trash2, User, Clock,
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

const ROLE_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  platform_admin: { color: '#92400e', bg: 'rgba(251,191,36,0.18)', label: 'Platform Admin' },
  admin:          { color: '#1e40af', bg: 'rgba(96,165,250,0.15)',  label: 'Admin' },
  member:         { color: '#6b7280', bg: 'rgba(156,163,175,0.15)', label: 'Member' },
  readonly:       { color: '#9ca3af', bg: 'rgba(209,213,219,0.12)', label: 'Read Only' },
};

const STATUS_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  ACTIVE:      { dot: 'bg-emerald-500',   text: 'text-emerald-600 dark:text-emerald-400', label: 'Active' },
  SUSPENDED:   { dot: 'bg-amber-500',     text: 'text-amber-600 dark:text-amber-400',     label: 'Suspended' },
  INVITED:     { dot: 'bg-blue-400',      text: 'text-blue-600 dark:text-blue-400',        label: 'Invited' },
  DEACTIVATED: { dot: 'bg-slate-400',     text: 'text-slate-500 dark:text-slate-400',      label: 'Deactivated' },
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
  const style = ROLE_BADGE[role] ?? ROLE_BADGE.readonly;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: '"IBM Plex Mono", monospace',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: style.color,
        background: style.bg,
        lineHeight: '1.6',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
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
        className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-[#1c2128] transition-colors"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--card)] border border-[var(--header-border)] dark:border-[#2d333b] rounded-lg shadow-lg overflow-hidden z-50">
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
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
            >
              <UserX className="h-3.5 w-3.5" />
              {user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
            </button>
          )}
          {canDeleteUsers && !isSelf && (
            <button
              onClick={() => { setOpen(false); onDeleteUser?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Deactivate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b dark:border-[#2d333b] animate-pulse">
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
      <div className="border rounded-lg dark:border-[#2d333b] bg-white dark:bg-[#0f131a] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b dark:border-[#2d333b] bg-slate-50 dark:bg-[#0f131a]">
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">User</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Role</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Status</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Provider</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Last Login</th>
              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Joined</th>
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
      <div className="border rounded-lg dark:border-[#2d333b] bg-white dark:bg-[#0f131a] overflow-hidden">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <User className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No users found</p>
          <p className="text-xs mt-1 opacity-75">Adjust your search or filters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg dark:border-[#2d333b] bg-white dark:bg-[#0f131a] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b dark:border-[#2d333b] bg-slate-50 dark:bg-[#0f131a]">
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">User</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Role</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Status</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Provider</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Last Login</th>
            <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Joined</th>
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
                  'border-b last:border-b-0 dark:border-[#2d333b] transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-[#1c2128]' : '',
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
