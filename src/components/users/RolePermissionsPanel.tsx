'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, Shield, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import styles from './users.module.css';

interface PermissionInfo {
  key: string;
  label: string;
  description: string;
  group: string;
  checked: boolean;
  platformAdminOnly?: boolean;
  sensitive?: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  kind: 'builtin' | 'role' | 'bundle';
  base: 'readonly' | 'member' | 'admin' | null;
  keys: string[];
  memberCount: number;
}

interface Data {
  canEdit: boolean;
  groups: Record<string, string>;
  permissions: PermissionInfo[];
  roles: RoleRow[];
}

const BUILT_IN_LABEL: Record<string, string> = { admin: 'Admin', member: 'Member', readonly: 'Read only' };

function roleLabel(r: RoleRow): string {
  return r.kind === 'builtin' ? BUILT_IN_LABEL[r.name] ?? r.name : r.name;
}

function roleSub(r: RoleRow): string {
  if (r.kind === 'builtin') return 'Built-in';
  if (r.kind === 'role') return r.base ? `Role · also ${BUILT_IN_LABEL[r.base]}` : 'Role';
  return 'Bundle · adds';
}

/**
 * Users → Permissions. Rows are permissions (grouped), columns are roles. Platform admins tick what
 * each built-in role, custom role and bundle carries; everyone else sees it read-only. Platform admin
 * always holds every permission. Section access (which screens open) is the other tab.
 */
export function RolePermissionsPanel({ notify }: { notify: (msg: string, type?: 'success' | 'error') => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/sections/permissions', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to permission settings.' : `HTTP ${res.status}`);
      setData((await res.json()) as Data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load permissions');
    }
  }, []);

  useEffect(() => {
    // Deferred a microtask so the fetch's state updates do not run inside the effect body.
    void Promise.resolve().then(load);
  }, [load]);

  const grouped = useMemo(() => {
    const out: { group: string; label: string; permissions: PermissionInfo[] }[] = [];
    for (const p of data?.permissions ?? []) {
      let g = out.find((x) => x.group === p.group);
      if (!g) {
        g = { group: p.group, label: data?.groups[p.group] ?? p.group, permissions: [] };
        out.push(g);
      }
      g.permissions.push(p);
    }
    return out;
  }, [data]);

  const has = (r: RoleRow, key: string) => (drafts[r.id] ?? new Set(r.keys)).has(key);

  function toggle(r: RoleRow, key: string, on: boolean) {
    setDrafts((d) => {
      const next = new Set(d[r.id] ?? r.keys);
      if (on) next.add(key);
      else next.delete(key);
      return { ...d, [r.id]: next };
    });
  }

  const dirty = (data?.roles ?? []).filter((r) => {
    const d = drafts[r.id];
    if (!d) return false;
    const before = new Set(r.keys);
    return d.size !== before.size || [...d].some((k) => !before.has(k));
  });

  async function saveAll() {
    setSaving(true);
    try {
      for (const r of dirty) {
        const res = await fetch(`/api/sections/permissions/${r.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: [...drafts[r.id]] }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
          throw new Error(`${roleLabel(r)}: ${body?.message ?? body?.error ?? `save failed (${res.status})`}`);
        }
      }
      setDrafts({});
      await load();
      notify(dirty.length === 1 ? `Permissions saved for ${roleLabel(dirty[0])}` : `Permissions saved for ${dirty.length} roles`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to save', 'error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="m-5 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-size-ui text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
        {error}{' '}
        <button onClick={() => void load()} className="underline">Retry</button>
      </div>
    );
  }
  if (!data) return <p role="status" className="px-6 py-8 text-size-ui text-muted-foreground">Loading permissions…</p>;

  const { canEdit, roles } = data;
  const builtInDirty = dirty.filter((r) => r.kind === 'builtin');

  return (
    <div>
      <div className={styles.toolbar}>
        <p className="mr-auto max-w-3xl text-size-ui text-muted-foreground">
          Permissions are finer rights some screens check on top of section access, such as asking questions or publishing a flow that sends email.
          People with a custom role also hold its starting role, so they get both columns&apos; permissions; a bundle adds its permissions to whoever has it.
          {canEdit ? ' Tick what each role carries and save.' : ' Only platform admins can change these.'}
        </p>
      </div>

      {dirty.length > 0 && (
        <div className={styles.saveBar} role="status">
          <span>
            Unsaved changes in {dirty.length === 1 ? '1 role' : `${dirty.length} roles`}
            {builtInDirty.length > 0 && (
              <> · {builtInDirty.map(roleLabel).join(', ')} changes apply to everyone with {builtInDirty.length === 1 ? 'that role' : 'those roles'}</>
            )}
          </span>
          <Button variant="outline" size="sm" className={cn(styles.secondaryButton, 'text-size-ui')} onClick={() => setDrafts({})} disabled={saving}>
            Discard
          </Button>
          <Button size="sm" className={cn(styles.primary, 'gap-2 text-size-ui')} onClick={() => void saveAll()} disabled={saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save changes'}
          </Button>
        </div>
      )}

      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th scope="col" className={styles.matrixSection}>Permission</th>
              <th scope="col">
                <div>Platform admin</div>
                <div className="mt-0.5 text-caption font-normal text-muted-foreground">Always everything</div>
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className={r.kind === 'builtin' ? undefined : styles.bundleHead}>
                  <div className="flex items-center justify-center gap-1">
                    {r.kind === 'role' && <Shield aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" />}
                    {r.kind === 'bundle' && <Layers aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" />}
                    <span className="truncate" title={r.name}>{roleLabel(r)}</span>
                  </div>
                  <div className="mt-0.5 text-caption font-normal text-muted-foreground">
                    {roleSub(r)} · {r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => (
              <PermissionGroupRows key={g.group} label={g.label} permissions={g.permissions} roles={roles} canEdit={canEdit} has={has} toggle={toggle} saving={saving} />
            ))}
          </tbody>
        </table>
      </div>

      {roles.length === 0 && (
        <p className="px-6 py-4 text-size-ui text-muted-foreground">No roles found. Run the database seed to create the built-in roles.</p>
      )}
      <p className="border-t border-[var(--estate-border)] px-6 py-3 text-caption text-muted-foreground">
        Rows marked &ldquo;not checked yet&rdquo; are stored but no screen reads them today; those screens use section access instead.
        Changes take effect on each person&apos;s next request.
      </p>
    </div>
  );
}

function PermissionGroupRows({ label, permissions, roles, canEdit, has, toggle, saving }: {
  label: string;
  permissions: PermissionInfo[];
  roles: RoleRow[];
  canEdit: boolean;
  has: (r: RoleRow, key: string) => boolean;
  toggle: (r: RoleRow, key: string, on: boolean) => void;
  saving: boolean;
}) {
  return (
    <>
      <tr className={styles.groupRow}>
        <th scope="rowgroup" colSpan={2 + roles.length} className="text-left">
          {label}
        </th>
      </tr>
      {permissions.map((p) => (
        <tr key={p.key}>
          <th scope="row" className={styles.matrixSection}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.label}</span>
              {!p.checked && <span className={styles.pendingTag}>not checked yet</span>}
              {p.platformAdminOnly && <span className={styles.pendingTag}>platform admins only</span>}
              {p.sensitive && <span className={styles.warnTag}>sensitive</span>}
            </div>
            <div className="mt-0.5 text-caption text-muted-foreground">
              {p.description} <code className="text-caption">{p.key}</code>
            </div>
          </th>
          <td>
            <ShieldCheck aria-label="Always" className="mx-auto h-4 w-4 text-[var(--ok)]" />
          </td>
          {roles.map((r) => {
            const on = has(r, p.key);
            const changed = on !== r.keys.includes(p.key);
            return (
              <td key={r.id} className={cn(r.kind !== 'builtin' && styles.bundleCell, changed && styles.cellChanged)}>
                {canEdit && !p.platformAdminOnly ? (
                  <input
                    type="checkbox"
                    className={styles.permCheck}
                    aria-label={`${roleLabel(r)}: ${p.label}`}
                    checked={on}
                    disabled={saving}
                    onChange={(e) => toggle(r, p.key, e.target.checked)}
                  />
                ) : on ? (
                  <span className={styles.permMark} aria-label="Yes">✓</span>
                ) : (
                  <span className={styles.permNone} aria-label="No">—</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
