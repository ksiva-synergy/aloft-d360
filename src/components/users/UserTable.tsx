'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  MoreHorizontal, Pencil, Shield, UserX, Trash2, User, Clock, Ban,
  MessagesSquare, Brain, Bot,
} from 'lucide-react';
import { RoleBadge } from './RoleBadge';
import styles from './users.module.css';

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
  /** Section access bundles on top of the role (Users → Section access). */
  bundles?: { id: string; name: string }[];
  /** A custom role (sets every section exactly); primaryRole is then its built-in base. */
  customRole?: { id: string; name: string; base: 'readonly' | 'member' | 'admin' } | null;
  // Engagement metrics (aggregated server-side; default 0 when absent)
  logins7d?: number;
  logins30d?: number;
  sessions7d?: number;
  sessions30d?: number;
  inspectorChats?: number;
  agentChats?: number;
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
  return (
    <div title={title} className="min-w-[64px]">
      <div className="flex items-baseline gap-1.5 text-size-ui">
        <span className="font-semibold tabular-nums">{d30}</span>
        <span className="text-caption text-muted-foreground">{label.toLowerCase()}</span>
      </div>
      <div className="mt-1 text-caption text-muted-foreground">{d7} in 7 days</div>
    </div>
  );
}

function ActivityCell({ user }: { user: UserRow }) {
  const l30 = user.logins30d ?? 0;
  const l7 = user.logins7d ?? 0;
  const s30 = user.sessions30d ?? 0;
  const s7 = user.sessions7d ?? 0;
  const insp = user.inspectorChats ?? 0;
  const agent = user.agentChats ?? 0;
  const mem = user.memoriesContributed ?? 0;
  return (
    <div className="flex items-center gap-3">
      <MetricChip label="Logins" d30={l30} d7={l7} title={`${l30} sign-ins (30d) · ${l7} (7d)`} />
      <MetricChip label="Sessions" d30={s30} d7={s7} title={`${s30} workbench sessions (30d) · ${s7} (7d)`} />
      {(insp > 0 || agent > 0 || mem > 0) && (
        <div className="flex flex-col gap-0.5 pl-1" title={`${insp} inspector chats · ${agent} agent chats · ${mem} memories`}>
          {insp > 0 && (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption-size)] text-muted-foreground">
              <MessagesSquare className="h-3 w-3 shrink-0 opacity-70" />
              <span className="tabular-nums font-medium text-[var(--foreground)]">{insp}</span>
            </span>
          )}
          {agent > 0 && (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption-size)] text-muted-foreground">
              <Bot className="h-3 w-3 shrink-0 opacity-70" />
              <span className="tabular-nums font-medium text-[var(--foreground)]">{agent}</span>
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

function ProviderBadge({ provider }: { provider: string }) {
  const isAad = provider === 'aad';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap text-size-ui text-muted-foreground',
      )}
    >
      {isAad && <Shield className="h-3.5 w-3.5" aria-hidden="true" />}
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
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const isSelf = user.id === currentUserId;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    }
    function close() { setOpen(false); }
    if (open) {
      document.addEventListener('mousedown', handle);
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
      menuRef.current?.querySelector('button')?.focus();
    }
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const hasActions = canAssignRoles || canUpdateUsers || canDeleteUsers;
  if (!hasActions) return null;

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        aria-label={`Actions for ${user.name || user.email}`}
        aria-expanded={open}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 210)), right: Math.max(8, window.innerWidth - rect.right) });
          setOpen((p) => !p);
        }}
        className="flex items-center justify-center w-8 h-8 rounded-sm text-muted-foreground hover:text-foreground hover:bg-[var(--estate-hover)]"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && createPortal(
        <div ref={menuRef} style={position} className={cn(styles.surface, styles.actionMenu, 'fixed w-52 bg-[var(--estate-surface)] border border-[var(--estate-border)] overflow-hidden z-50')}>
          {canUpdateUsers && (
            <button
              onClick={() => { setOpen(false); onEditUser?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-size-ui text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              View profile
            </button>
          )}
          {canAssignRoles && (
            <button
              onClick={() => { setOpen(false); onChangeRole?.(user); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-size-ui text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              Change Role
            </button>
          )}
          {canUpdateUsers && !isSelf && (
            <button
              onClick={() => { setOpen(false); onToggleStatus?.(user); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-size-ui transition-colors',
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
              className="flex items-center gap-2 w-full px-3 py-2 text-size-ui text-[color:var(--ink-2)] dark:text-[color:var(--ink-3)] hover:bg-[var(--estate-hover)] transition-colors border-t border-[var(--estate-border)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove User
            </button>
          )}
        </div>,
        document.body,
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
  if (!loading && users.length === 0) {
    return (
      <div className={styles.surface}>
        <div className="flex flex-col items-center justify-center px-6 py-20 text-muted-foreground text-center">
          <div className="mb-4 rounded-full bg-[var(--muted)] p-4"><User className="h-6 w-6" /></div>
          <p className="text-title-card text-[var(--estate-ink)]">No users found</p>
          <p className="text-size-ui mt-2">Try a different search or filter, or invite someone to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      <div className="overflow-x-auto" role="region" aria-label="User directory table" tabIndex={0}>
      <table className={styles.table} aria-busy={loading}>
        <caption className="sr-only">{loading ? 'Loading users' : 'Workspace users, roles, access, and activity'}</caption>
        <thead>
          <tr className="border-b border-[var(--estate-border)] bg-[var(--estate-th-bg)]">
            <th scope="col" className="min-w-[250px]">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Sign-in method</th>
            <th scope="col">Last login / joined</th>
            <th scope="col" className="min-w-[200px]">Activity <span className="ml-1 text-muted-foreground">(30d)</span></th>
            <th scope="col" className="w-10"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {loading ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />) : users.map((user) => {
            const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.DEACTIVATED;
            const initials = getInitials(user.name, user.email);
            const isSelf = user.id === currentUserId;

            return (
              <tr
                key={user.id}
                onClick={() => onRowClick?.(user)}
                className={cn(
                  'border-b border-[var(--estate-border)] last:border-b-0 transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--ink-1)_5%,var(--surface-1))]' : '',
                )}
              >
                {/* User column */}
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(styles.avatar, ['platform_admin', 'admin'].includes(user.primaryRole) && styles.avatarAdmin)}
                      aria-hidden="true"
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 max-w-[240px]">
                      <div className="flex items-center gap-1.5 text-size-ui font-medium text-[var(--foreground)]">
                        <button type="button" onClick={(event) => { event.stopPropagation(); onRowClick?.(user); }} className="truncate text-left hover:text-[var(--brand-a-ink)]" aria-label={`View profile for ${user.name || user.email}`}>
                          {user.name || <span className="italic text-muted-foreground font-normal">No name</span>}
                        </button>
                        {isSelf && (
                          <span className="shrink-0 rounded-sm px-1.5 py-px text-caption text-muted-foreground bg-[var(--muted)]">
                            You
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-caption text-muted-foreground" title={user.email}>{user.email}</div>
                    </div>
                  </div>
                </td>

                {/* Role column */}
                <td className="px-4 py-3">
                  <RoleBadge role={user.primaryRole} label={user.roleLabel} className="whitespace-nowrap !rounded-full !font-medium !px-3 !py-1.5" />
                </td>

                {/* Status column */}
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center gap-1.5 text-size-ui', status.text)}>
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
                  <span className="inline-flex items-center gap-1.5 text-size-ui text-[var(--estate-ink)]">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {formatRelative(user.lastLoginAt)}
                  </span>
                  <div className="mt-1 text-caption text-muted-foreground">Joined {formatJoinDate(user.createdAt)}</div>
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
