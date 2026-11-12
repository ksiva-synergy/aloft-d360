'use client';

import { useState, useEffect, useCallback, useMemo, type ElementType } from 'react';
import { useSession } from 'next-auth/react';
import { Search, UserPlus, Users, RefreshCw, Shield, UserCheck, KeyRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserTable, type UserRow } from '@/components/users/UserTable';
import { UserDetailDrawer } from '@/components/users/UserDetailDrawer';
import { InviteUserModal } from '@/components/users/InviteUserModal';
import { ChangeRoleModal } from '@/components/users/ChangeRoleModal';
import { SectionAccessPanel } from '@/components/users/SectionAccessPanel';
import { RolePermissionsPanel } from '@/components/users/RolePermissionsPanel';
import { PersonSectionAccess } from '@/components/users/PersonSectionAccess';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';
import type { SectionLevel } from '@/lib/sections/registry';
import styles from '@/components/users/users.module.css';

// What this person can do here comes from section access (src/lib/sections): View on Users lists people,
// Manage invites, edits, re-roles, and removes them. The APIs check the same rules.
function getPermissionsForLevels(users: SectionLevel | null, dataAccess: SectionLevel | null) {
  const manage = users === 'manage';
  return {
    canReadUsers: users === 'view' || manage,
    canCreateUsers: manage,
    canUpdateUsers: manage,
    canDeleteUsers: manage,
    canAssignRoles: manage,
    canManageDataAccess: dataAccess === 'manage',
  };
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
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: ElementType;
}) {
  return (
    <div className={styles.stat}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-size-ui font-medium text-muted-foreground">{label}</span>
        <span className={styles.statIcon}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      </div>
      <div className="mt-2 text-kpi-md tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-caption text-muted-foreground">{sub}</div>}
    </div>
  );
}

function DirectoryFilter({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || 'all'} onValueChange={(next) => onChange(next === 'all' ? '' : next)}>
      <SelectTrigger aria-label={label} className={styles.selectTrigger}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={8} className={cn(styles.surface, styles.selectMenu, 'min-w-[220px] z-[100] [&>div]:!h-auto')}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value || 'all'} className={styles.selectItem}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function UsersPage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  const currentUserId = sessionUser?.id;
  const me = useSectionLevels();
  const perms = getPermissionsForLevels(me?.levels['govern.users'] ?? null, me?.levels['govern.data-access'] ?? null);
  const [tab, setTab] = useState<'people' | 'sections' | 'permissions'>('people');

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
    } catch {
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers, refreshKey]);

  // The open profile, refreshed from the latest list (so saved changes show without reopening).
  const drawerCurrent = drawerUser ? (users.find((u) => u.id === drawerUser.id) ?? drawerUser) : null;

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
  const stats = useMemo(() => {
    const platformAdmins = users.filter((u) => u.primaryRole === 'platform_admin').length;
    const admins = users.filter((u) => u.primaryRole === 'admin').length;
    return {
      total: users.length,
      active: users.filter((u) => u.status === 'ACTIVE').length,
      elevated: platformAdmins + admins,
      platformAdmins,
      admins,
      sso: users.filter((u) => u.authProvider === 'aad').length,
    };
  }, [users]);

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
    <div className={cn(styles.surface, styles.page)}>
      <div className={styles.content}>
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <div className="mb-1 flex items-center gap-2 text-eyebrow uppercase text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-a)]" />
            Workspace administration
          </div>
          <h1 className="text-title-section">Users &amp; access</h1>
          <p className="mt-1 text-size-ui text-muted-foreground">
            Manage your people, their roles, and how they access the platform.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className={cn(styles.iconButton, 'disabled:opacity-40')}
            title="Refresh users"
            aria-label="Refresh users"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          {perms.canCreateUsers && (
            <Button onClick={() => setInviteOpen(true)} className={cn(styles.primary, 'gap-2 text-size-ui')}>
              <UserPlus className="h-4 w-4" />
              Invite user
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      {!loading && !error && (
        <div className={styles.summary}>
          <StatCard label="Total users" value={stats.total} sub="People in your workspace" icon={Users} />
          <StatCard
            label="Active accounts"
            value={stats.active}
            sub={stats.total - stats.active > 0 ? `${stats.total - stats.active} not active` : 'All accounts active'}
            icon={UserCheck}
          />
          <StatCard
            label="Elevated roles"
            value={stats.elevated}
            sub={`${stats.platformAdmins} platform · ${stats.admins} admin`}
            icon={Shield}
          />
          <StatCard label="Single sign-on" value={stats.sso} sub="Connected with Microsoft Entra" icon={KeyRound} />
        </div>
      )}

      <div role="tablist" aria-label="Users views" className={cn(styles.tabs, '!px-0 mb-4', (loading || error) && 'mt-5')}>
        <button role="tab" type="button" id="tab-people" aria-selected={tab === 'people'} aria-controls="panel-people" className={styles.tab} onClick={() => setTab('people')}>
          People
        </button>
        <button role="tab" type="button" id="tab-sections" aria-selected={tab === 'sections'} aria-controls="panel-sections" className={styles.tab} onClick={() => setTab('sections')}>
          Section access
        </button>
        <button role="tab" type="button" id="tab-permissions" aria-selected={tab === 'permissions'} aria-controls="panel-permissions" className={styles.tab} onClick={() => setTab('permissions')}>
          Permissions
        </button>
      </div>

      {tab === 'permissions' ? (
        <section id="panel-permissions" role="tabpanel" aria-labelledby="tab-permissions" className={styles.directory}>
          <div className={styles.directoryHeader}>
            <h2 className="text-title-card">Permissions</h2>
            <span className="text-caption text-muted-foreground">What each role may do inside the sections it can open</span>
          </div>
          <RolePermissionsPanel notify={showToast} />
        </section>
      ) : tab === 'sections' ? (
        <section id="panel-sections" role="tabpanel" aria-labelledby="tab-sections" className={styles.directory}>
          <div className={styles.directoryHeader}>
            <h2 className="text-title-card">Section access</h2>
            <span className="text-caption text-muted-foreground">Who can open each part of ALOFT, and who can make changes there</span>
          </div>
          <SectionAccessPanel users={users} onMembersChanged={() => setRefreshKey((k) => k + 1)} notify={showToast} />
        </section>
      ) : (
      <section id="panel-people" role="tabpanel" aria-labelledby="tab-people" className={styles.directory}>
        <div className={styles.directoryHeader}>
          <div className="flex items-center gap-3">
            <h2 id="directory-title" className="text-title-card">People directory</h2>
            {!loading && !error && <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-caption text-muted-foreground">{users.length} users</span>}
          </div>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><Shield className="h-3.5 w-3.5" />Role-based access</span>
        </div>
      <div className={styles.toolbar}>
        {/* Search */}
        <div className="relative w-full sm:flex-1 sm:mr-auto sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search name or email…"
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(styles.input, '!pl-10')}
          />
        </div>

        <DirectoryFilter label="Filter by role" value={roleFilter} onChange={setRoleFilter} options={ROLE_OPTIONS} />
        <DirectoryFilter label="Filter by status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />

        {(search || roleFilter || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }}
            className="inline-flex items-center gap-1 text-size-ui text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div role="alert" className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded-sm m-5 px-4 py-3 text-size-ui text-red-600 dark:text-red-400 flex items-center gap-2">
          <span>{error}</span>
          <button
            onClick={loadUsers}
            className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-300 underline text-size-ui"
          >
            Retry
          </button>
        </div>
      )}

      {/* User table */}
      {!error && <UserTable
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
      />}
      {!loading && !error && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--estate-border)] px-6 py-4 text-caption text-muted-foreground">
          <span role="status">Showing {filtered.length} of {users.length} users</span>
          <span>Activity reflects the last 30 days</span>
        </div>
      )}
      </section>
      )}

      {/* Detail drawer */}
      <UserDetailDrawer
        user={drawerCurrent}
        open={drawerOpen}
        currentUserId={currentUserId}
        canAssignRoles={perms.canAssignRoles}
        canUpdateUsers={perms.canUpdateUsers}
        canDeleteUsers={perms.canDeleteUsers}
        canManageDataAccess={perms.canManageDataAccess}
        sectionAccess={
          me?.platformAdmin && drawerCurrent ? (
            <PersonSectionAccess
              key={`${drawerCurrent.id}:${drawerCurrent.customRole?.id ?? ''}:${(drawerCurrent.bundles ?? []).map((b) => b.id).join(',')}`}
              user={drawerCurrent}
              onSaved={() => setRefreshKey((k) => k + 1)}
              notify={showToast}
            />
          ) : null
        }
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
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'fixed bottom-5 right-5 z-[100] px-4 py-2.5 rounded-lg shadow-lg text-size-ui font-medium transition',
            toast.type === 'success'
              ? 'bg-emerald-600 dark:bg-emerald-700 text-white'
              : 'bg-red-600 dark:bg-red-700 text-white',
          )}
        >
          {toast.msg}
        </div>
      )}
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform Admin',
  admin: 'Admin',
  member: 'Member',
  readonly: 'Read Only',
};
