'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCw, ShieldAlert, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BUILT_IN_ROLES } from '@/lib/sections/registry';
import { RoleBadge } from '@/components/users/RoleBadge';
import styles from '@/components/users/users.module.css';
import { cn } from '@/lib/utils';

type AccessRequest = {
  id: string;
  email: string;
  name: string | null;
  authProvider: string;
  createdAt: string;
};

const ROLE_OPTIONS = BUILT_IN_ROLES.filter((r) => r !== 'platform_admin');

export default function AccessRequestsPage() {
  const { data: session } = useSession();
  const isPlatformAdmin = (session?.user as { role?: string } | undefined)?.role === 'platform_admin';

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleById, setRoleById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users/access-requests');
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Could not load access requests');
        setRequests([]);
        return;
      }
      const rows = (data.requests ?? []) as AccessRequest[];
      setRequests(rows);
      setRoleById((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (!next[r.id]) next[r.id] = 'member';
        }
        return next;
      });
    } catch {
      setError('Could not load access requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformAdmin) void load();
    else setLoading(false);
  }, [isPlatformAdmin, load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    setToast(null);
    try {
      const body =
        action === 'approve'
          ? { action: 'approve' as const, role: roleById[id] ?? 'member' }
          : { action: 'reject' as const };
      const res = await fetch(`/api/users/access-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data?.message ?? `Request failed (${res.status})`);
        return;
      }
      setRequests((list) => list.filter((r) => r.id !== id));
      setToast(action === 'approve' ? 'Access granted. They can sign in again with Microsoft.' : 'Request rejected.');
    } catch {
      setToast('Unexpected error. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-title-section">Platform admin only</h1>
        <p className="mt-2 text-body text-muted-foreground">
          SSO access requests are reviewed by platform administrators.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(styles.page, 'max-w-4xl')}>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title-page">Access requests</h1>
          <p className="mt-1 text-body text-muted-foreground">
            People who signed in with Microsoft before an administrator admitted them. Approve with a role, or reject.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </header>

      {toast && (
        <p role="status" className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-size-ui">
          {toast}
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 text-size-ui text-[var(--bad)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : requests.length === 0 ? (
        <p className="text-body text-muted-foreground">No pending requests.</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className={cn(styles.stat, 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between')}>
              <div>
                <div className="font-medium">{r.name?.trim() || r.email}</div>
                <div className="text-caption text-muted-foreground">{r.email}</div>
                <div className="mt-1 text-caption text-muted-foreground">
                  Requested {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-size-ui">
                  <span className="text-muted-foreground">Role</span>
                  <select
                    className={cn(styles.selectTrigger, 'h-9 min-w-[140px]')}
                    value={roleById[r.id] ?? 'member'}
                    onChange={(e) => setRoleById((m) => ({ ...m, [r.id]: e.target.value }))}
                    disabled={busyId === r.id}
                    aria-label={`Role for ${r.email}`}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <RoleBadge role={roleById[r.id] ?? 'member'} />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void decide(r.id, 'approve')}
                  disabled={busyId === r.id}
                >
                  {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void decide(r.id, 'reject')}
                  disabled={busyId === r.id}
                >
                  <UserX className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
