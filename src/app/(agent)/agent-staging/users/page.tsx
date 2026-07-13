'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Search, UserPlus, Users, RefreshCw, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { UserTable, type UserRow } from '@/components/users/UserTable';
import { UserDetailDrawer } from '@/components/users/UserDetailDrawer';
import { InviteUserModal } from '@/components/users/InviteUserModal';
import { ChangeRoleModal } from '@/components/users/ChangeRoleModal';

// Derive permissions from role — mirrors src/lib/rbac.ts permission mappings
function getPermissionsForRole(role?: string | null) {
  switch (role) {
    case 'platform_admin':
      return {
        canReadUsers: true, canCreateUsers: true, canUpdateUsers: true,
        canDeleteUsers: true, canAssignRoles: true,
      };
    case 'admin':
      return {
        canReadUsers: true, canCreateUsers: true, canUpdateUsers: true,
        canDeleteUsers: true, canAssignRoles: true,
      };
    default:
      return {
        canReadUsers: false, canCreateUsers: false, canUpdateUsers: false,
        canDeleteUsers: false, canAssignRoles: false,
      };
  }
}

const ROLE_OPTIONS = [
  { value: '',              label: 'All Roles' },
  { value: 'platform_admin', label: 'Platform Admin' },
  { value: 'admin',          label: 'Admin' },
  { value: 'member',         label: 'Member' },
  { value: 'readonly',       label: 'Read Only' },
];

const STATUS_OPTIONS = [
  { value: '',            label: 'All Statuses' },
  { value: 'ACTIVE',      label: 'Active' },
  { value: 'SUSPENDED',   label: 'Suspended' },
  { value: 'INVITED',     label: 'Invited' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-3.5">
      <div className="text-[22px] font-bold tabular-nums text-[var(--estate-ink)]">{value}</div>
      <div className="mt-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-[var(--estate-text-dim)]">{label}</div>
      {sub && <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function UsersPage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  const currentUserId = sessionUser?.id;
  const perms = getPermissionsForRole(sessionUser?.role);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals / drawer
  const [drawerUser, setDrawerUser] = useState<UserRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [changeRoleUser, setChangeRoleUser] = useState<UserRow | null>(null);
  const [changeRoleOpen, setChangeRoleOpen] = useState(false);

  // Toast state (lightweight)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { users: UserRow[] } = await res.json();
      setUsers(data.users ?? []);
    } catch (e) {
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers, refreshKey]);

  // Filtered view
  const filtered = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        u.email.toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q);
      const matchesRole = !roleFilter || u.primaryRole === roleFilter;
      const matchesStatus = !statusFilter || u.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Summary stats
  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'ACTIVE').length,
    admins: users.filter((u) => u.primaryRole === 'platform_admin' || u.primaryRole === 'admin').length,
    sso: users.filter((u) => u.authProvider === 'aad').length,
  }), [users]);

  // ---- Action handlers ----

  function handleRowClick(user: UserRow) {
    setDrawerUser(user);
    setDrawerOpen(true);
  }

  function handleChangeRole(user: UserRow) {
    setChangeRoleUser(user);
    setChangeRoleOpen(true);
    setDrawerOpen(false);
  }

  function handleRoleChanged(userId: string, newRole: string) {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId
          ? {
              ...u,
              primaryRole: newRole,
              roleLabel: ROLE_LABEL[newRole] ?? newRole,
              roles: [{ role: { name: newRole } }],
            }
          : u,
      ),
    );
    showToast('Role updated successfully');
  }

  async function handleToggleStatus(user: UserRow) {
    const newStatus = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: newStatus as UserRow['status'] } : u)),
      );
      showToast(`User ${newStatus === 'ACTIVE' ? 'unblocked' : 'blocked'}`);
      if (drawerUser?.id === user.id) {
        setDrawerUser((p) => p ? { ...p, status: newStatus as UserRow['status'] } : p);
      }
    } catch {
      showToast('Failed to update user status', 'error');
    }
  }

  async function handleDeleteUser(user: UserRow) {
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setDrawerOpen(false);
      showToast('User removed');
    } catch {
      showToast('Failed to deactivate user', 'error');
    }
  }

  return (
    <div className="p-6 max-w-7xl space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2 text-[var(--estate-ink)]">
            <Users className="h-5 w-5 shrink-0 text-[#FDB515]" />
            Users
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--estate-text-dim)]">
            Platform users and role assignments · Access control
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          {perms.canCreateUsers && (
            <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5 text-[12.5px]">
              <UserPlus className="h-3.5 w-3.5" />
              Invite User
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {!loading && !error && users.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Users" value={stats.total} />
          <StatCard label="Active" value={stats.active} sub={`${stats.total - stats.active} inactive`} />
          <StatCard label="Admins" value={stats.admins} sub="Platform + Admin" />
          <StatCard label="SSO (Entra)" value={stats.sso} sub="Azure AD users" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-full pl-8 pr-3 py-1.5 text-[12.5px] rounded-md border',
              'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
              'focus:outline-none focus:ring-1 focus:ring-[#FDB515] focus:border-[#FDB515]',
              'placeholder:text-muted-foreground',
            )}
          />
        </div>

        {/* Role filter */}
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={cn(
              'pl-3 pr-7 py-1.5 text-[12.5px] rounded-md border appearance-none',
              'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
              'focus:outline-none focus:ring-1 focus:ring-[#FDB515] focus:border-[#FDB515]',
            )}
          >
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={cn(
              'pl-3 pr-7 py-1.5 text-[12.5px] rounded-md border appearance-none',
              'bg-[var(--estate-surface)] border-[var(--estate-border)] text-[var(--estate-ink)]',
              'focus:outline-none focus:ring-1 focus:ring-[#FDB515] focus:border-[#FDB515]',
            )}
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        </div>

        {/* Active filter count */}
        {(search || roleFilter || statusFilter) && (
          <span className="text-[11.5px] text-muted-foreground">
            {filtered.length} of {users.length} shown
          </span>
        )}
        {(search || roleFilter || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }}
            className="text-[11.5px] text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded-lg px-4 py-3 text-[12.5px] text-red-600 dark:text-red-400 flex items-center gap-2">
          <span>{error}</span>
          <button
            onClick={loadUsers}
            className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-300 underline text-[12px]"
          >
            Retry
          </button>
        </div>
      )}

      {/* User table */}
      <UserTable
        users={filtered}
        loading={loading}
        currentUserId={currentUserId}
        canAssignRoles={perms.canAssignRoles}
        canUpdateUsers={perms.canUpdateUsers}
        canDeleteUsers={perms.canDeleteUsers}
        onRowClick={handleRowClick}
        onChangeRole={handleChangeRole}
        onEditUser={(user) => { setDrawerUser(user); setDrawerOpen(true); }}
        onToggleStatus={handleToggleStatus}
        onDeleteUser={handleDeleteUser}
      />

      {/* Detail drawer */}
      <UserDetailDrawer
        user={drawerUser}
        open={drawerOpen}
        currentUserId={currentUserId}
        canAssignRoles={perms.canAssignRoles}
        canUpdateUsers={perms.canUpdateUsers}
        canDeleteUsers={perms.canDeleteUsers}
        onClose={() => setDrawerOpen(false)}
        onChangeRole={handleChangeRole}
        onToggleStatus={handleToggleStatus}
        onDeleteUser={handleDeleteUser}
      />

      {/* Invite modal */}
      <InviteUserModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />

      {/* Change role modal */}
      <ChangeRoleModal
        open={changeRoleOpen}
        user={changeRoleUser}
        onOpenChange={setChangeRoleOpen}
        onSuccess={handleRoleChanged}
      />

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-5 right-5 z-[100] px-4 py-2.5 rounded-lg shadow-lg text-[12.5px] font-medium transition-all',
            toast.type === 'success'
              ? 'bg-emerald-600 dark:bg-emerald-700 text-white'
              : 'bg-red-600 dark:bg-red-700 text-white',
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform Admin',
  admin: 'Admin',
  member: 'Member',
  readonly: 'Read Only',
};
