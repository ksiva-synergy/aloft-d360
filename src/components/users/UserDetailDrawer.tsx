'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  X, Shield, UserX, Trash2, Mail, Calendar, Clock, Globe,
  RefreshCw, CheckCircle2, Building2, Ban, Activity, MessagesSquare, Brain,
} from 'lucide-react';
import type { UserRow } from './UserTable';

interface UserDetailDrawerProps {
  user: UserRow | null;
  open: boolean;
  currentUserId?: string;
  canAssignRoles?: boolean;
  canUpdateUsers?: boolean;
  canDeleteUsers?: boolean;
  onClose: () => void;
  onChangeRole?: (user: UserRow) => void;
  onToggleStatus?: (user: UserRow) => void;
  onDeleteUser?: (user: UserRow) => void;
}

// Brand-palette role chips — mirrors ROLE_BADGE_CLASS in UserTable.
const ROLE_BADGE_CLASS: Record<string, string> = {
  platform_admin: 'text-[#8a6a12] dark:text-[#FDB515] bg-[#FDB515]/10 border-[#FDB515]/30',
  admin:          'text-[#003262] dark:text-[#5B9DFF] bg-[#003262]/[0.07] dark:bg-[#5B9DFF]/10 border-[#003262]/20 dark:border-[#5B9DFF]/25',
  member:         'text-[#5A6A7A] dark:text-[#8892A4] bg-[#8892A4]/10 border-[#8892A4]/25',
  readonly:       'text-[#8A9BAD] dark:text-[#5A6A85] bg-transparent border-[#8892A4]/25',
};

const STATUS_CONFIG: Record<string, { dot: string; text: string; label: string; icon: React.ElementType }> = {
  ACTIVE:      { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Active',      icon: CheckCircle2 },
  SUSPENDED:   { dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',         label: 'Blocked',     icon: Ban },
  INVITED:     { dot: 'bg-blue-400',    text: 'text-blue-600 dark:text-blue-400',        label: 'Invited',     icon: Mail },
  DEACTIVATED: { dot: 'bg-slate-400',   text: 'text-slate-500 dark:text-slate-400',      label: 'Deactivated', icon: UserX },
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (email?.[0] ?? '?').toUpperCase();
}

function formatDateFull(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--estate-border)] last:border-b-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 font-medium">{label}</div>
        <div className="text-[12.5px] text-[var(--foreground)] break-all">{value}</div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon, value, label, hint,
}: { icon: React.ElementType; value: number; label: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-hover)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="font-mono text-[9px] uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className={cn(
        'mt-1 text-[18px] font-bold tabular-nums leading-none',
        value > 0 ? 'text-[var(--foreground)]' : 'text-muted-foreground/50',
      )}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[9.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function UserDetailDrawer({
  user,
  open,
  currentUserId,
  canAssignRoles,
  canUpdateUsers,
  canDeleteUsers,
  onClose,
  onChangeRole,
  onToggleStatus,
  onDeleteUser,
}: UserDetailDrawerProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Reset delete confirm when user changes
  useEffect(() => { setDeleteConfirm(false); }, [user?.id]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!user) return null;

  const initials = getInitials(user.name, user.email);
  const roleBadgeClass = ROLE_BADGE_CLASS[user.primaryRole] ?? ROLE_BADGE_CLASS.readonly;
  const status = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.DEACTIVATED;
  const StatusIcon = status.icon;
  const isSelf = user.id === currentUserId;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/40 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={cn(
          'fixed right-0 top-0 h-full w-[400px] max-w-full z-50',
          'bg-[var(--estate-surface)]',
          'border-l border-[var(--estate-border)]',
          'shadow-2xl flex flex-col overflow-hidden',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--estate-border)] shrink-0">
          <span className="text-[12px] font-semibold text-[var(--foreground)] uppercase tracking-wider">User Profile</span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Blocked banner */}
          {user.status === 'SUSPENDED' && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20">
              <Ban className="h-3.5 w-3.5 text-red-500 dark:text-red-400 shrink-0" />
              <span className="text-[11.5px] font-medium text-red-700 dark:text-red-300">
                This account is blocked — login is denied.
              </span>
            </div>
          )}

          {/* Identity card */}
          <div className="px-5 py-5 border-b border-[var(--estate-border)]">
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-bold shrink-0 select-none"
                style={{ background: '#003262', color: '#FDB515' }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[var(--foreground)] truncate">
                  {user.name || <span className="italic text-muted-foreground font-normal text-sm">No display name</span>}
                  {isSelf && (
                    <span className="ml-2 text-[9px] font-mono font-bold uppercase tracking-wider text-[#FDB515]">you</span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted-foreground truncate font-mono mt-0.5">{user.email}</div>
                <div className="flex items-center gap-2 mt-2">
                  {/* Role badge */}
                  <span
                    className={cn(
                      'inline-block whitespace-nowrap rounded border px-[7px] py-px',
                      'font-mono text-[10px] font-semibold uppercase leading-[1.6] tracking-[0.05em]',
                      roleBadgeClass,
                    )}
                  >
                    {user.roleLabel}
                  </span>
                  {/* Status badge */}
                  <span className={cn('inline-flex items-center gap-1 text-[11px]', status.text)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', status.dot)} />
                    {status.label}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="px-5 py-1">
            <InfoRow icon={Mail}      label="Email"         value={<span className="font-mono">{user.email}</span>} />
            <InfoRow icon={Shield}    label="Role"          value={user.roleLabel} />
            <InfoRow icon={StatusIcon} label="Account Status" value={status.label} />
            <InfoRow
              icon={Globe}
              label="Auth Provider"
              value={
                user.authProvider === 'aad'
                  ? 'Microsoft Entra ID (SSO)'
                  : user.authProvider === 'credentials'
                  ? 'Username & Password'
                  : user.authProvider
              }
            />
            {user.aadObjectId && (
              <InfoRow icon={Building2} label="AAD Object ID" value={<span className="font-mono text-[11px] break-all">{user.aadObjectId}</span>} />
            )}
            <InfoRow icon={Clock}    label="Last Login"  value={formatDateFull(user.lastLoginAt)} />
            <InfoRow icon={Calendar} label="Joined"      value={formatDateFull(user.createdAt)} />
          </div>

          {/* Activity & contributions */}
          <div className="px-5 py-4 border-t border-[var(--estate-border)]">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">
              <Activity className="h-3 w-3" />
              Activity &amp; Contributions
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <StatTile icon={Clock}          value={user.logins7d ?? 0}            label="Logins"    hint="Last 7 days" />
              <StatTile icon={Clock}          value={user.logins30d ?? 0}           label="Logins"    hint="Last 30 days" />
              <StatTile icon={Calendar}       value={user.sessions7d ?? 0}          label="Workbench" hint="Sessions · 7 days" />
              <StatTile icon={Calendar}       value={user.sessions30d ?? 0}         label="Workbench" hint="Sessions · 30 days" />
              <StatTile icon={MessagesSquare} value={user.inspectorChats ?? 0}      label="Inspector" hint="Chat sessions" />
              <StatTile icon={Brain}          value={user.memoriesContributed ?? 0} label="Memories"  hint="Contributed" />
            </div>
          </div>

          {/* Actions */}
          {(canAssignRoles || (canUpdateUsers && !isSelf) || (canDeleteUsers && !isSelf)) && (
            <div className="px-5 py-4 border-t border-[var(--estate-border)]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-3">Actions</div>
              <div className="flex flex-col gap-2">
                {canAssignRoles && (
                  <button
                    onClick={() => onChangeRole?.(user)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-md text-[12.5px] text-[var(--foreground)] bg-[var(--estate-hover)] hover:bg-[var(--estate-active-bg)] border border-[var(--estate-border)] transition-colors"
                  >
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    Change Role
                  </button>
                )}
                {canUpdateUsers && !isSelf && (
                  <button
                    onClick={() => onToggleStatus?.(user)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-md text-[12.5px] border transition-colors',
                      user.status === 'SUSPENDED'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                        : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/20',
                    )}
                  >
                    {user.status === 'SUSPENDED'
                      ? <><RefreshCw className="h-3.5 w-3.5" />Unblock User</>
                      : <><Ban className="h-3.5 w-3.5" />Block User</>
                    }
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Danger zone */}
          {canDeleteUsers && !isSelf && (
            <div className="px-5 py-4 border-t border-[var(--estate-border)]">
              <div className="text-[10px] uppercase tracking-wider text-red-500 dark:text-red-400 font-medium mb-3">Danger Zone</div>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-md text-[12.5px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors w-full"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove User
                </button>
              ) : (
                <div className="rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3 space-y-2">
                  <p className="text-[11.5px] text-red-700 dark:text-red-300">
                    This will permanently remove the account and prevent login. The user&apos;s data is preserved.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setDeleteConfirm(false); onDeleteUser?.(user); }}
                      className="flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 transition-colors"
                    >
                      Confirm Remove
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="flex-1 px-3 py-1.5 rounded text-[11.5px] font-medium text-[var(--foreground)] bg-[var(--muted)] hover:bg-[var(--estate-active-bg)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
