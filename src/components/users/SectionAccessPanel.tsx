'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Loader2, Pencil, Plus, Search, Shield, Trash2, Users as UsersIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserDialogContent } from './UserDialogContent';
import type { UserRow } from './UserTable';
import styles from './users.module.css';

type Level = 'none' | 'view' | 'manage';
type DefaultRole = 'readonly' | 'member' | 'admin';

interface SectionInfo {
  id: string;
  label: string;
  group: string;
  view: string;
  manage: string;
  defaults: Record<DefaultRole, Level>;
  viewOnly: boolean;
  platformAdminActionsOnly: boolean;
  enforced: boolean;
  bundleCeiling: 'view' | 'manage';
}

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  /** role: sets every section exactly (custom role); bundle: adds on top of a role. */
  kind: 'role' | 'bundle';
  base: DefaultRole | null;
  levels: Record<string, Level>;
  members: { id: string; name: string | null; email: string }[];
}

interface Matrix {
  canEdit: boolean;
  groups: Record<string, string>;
  sections: SectionInfo[];
  bundles: Bundle[];
}

const LEVEL_LABEL: Record<Level, string> = { none: 'No access', view: 'View', manage: 'Manage' };
const BASE_LABEL: Record<DefaultRole, string> = { readonly: 'Read only', member: 'Member', admin: 'Admin' };
const ROLE_COLUMNS: { key: DefaultRole | 'platform_admin'; label: string }[] = [
  { key: 'readonly', label: 'Read only' },
  { key: 'member', label: 'Member' },
  { key: 'admin', label: 'Admin' },
  { key: 'platform_admin', label: 'Platform admin' },
];

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(data?.message ?? data?.error ?? `Request failed (${res.status})`);
  }
}

function roleLevel(s: SectionInfo, role: DefaultRole | 'platform_admin'): Level {
  if (role === 'platform_admin') return s.viewOnly ? 'view' : 'manage';
  return s.defaults[role];
}

function LevelChip({ level, muted }: { level: Level; muted?: boolean }) {
  return (
    <span className={cn(styles.levelChip, styles[`level_${level}`], muted && styles.levelMuted)}>
      {level === 'none' ? '—' : LEVEL_LABEL[level]}
    </span>
  );
}

/**
 * Users → Section access. Rows are sections (grouped like the sidebar), columns are the built-in
 * roles (fixed defaults) and each bundle (editable by platform admins). A person's level on a
 * section is the highest of their role default and their bundles. Data Estate actions stay with
 * platform admins whatever a bundle says.
 */
export function SectionAccessPanel({ users, onMembersChanged, notify }: {
  users: UserRow[];
  onMembersChanged: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, Level>>>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Bundle | 'new-role' | 'new-bundle' | null>(null);
  const [membersOf, setMembersOf] = useState<Bundle | null>(null);
  const [deleting, setDeleting] = useState<Bundle | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/sections', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to section settings.' : `HTTP ${res.status}`);
      setMatrix((await res.json()) as Matrix);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load section access');
    }
  }, []);

  useEffect(() => {
    // Deferred a microtask so the fetch's state updates do not run inside the effect body.
    void Promise.resolve().then(load);
  }, [load]);

  const grouped = useMemo(() => {
    const out: { group: string; label: string; sections: SectionInfo[] }[] = [];
    for (const s of matrix?.sections ?? []) {
      let g = out.find((x) => x.group === s.group);
      if (!g) {
        g = { group: s.group, label: matrix?.groups[s.group] ?? s.group, sections: [] };
        out.push(g);
      }
      g.sections.push(s);
    }
    return out;
  }, [matrix]);

  const levelOf = (b: Bundle, sectionId: string): Level => drafts[b.id]?.[sectionId] ?? b.levels[sectionId] ?? 'none';

  function setLevel(b: Bundle, s: SectionInfo, level: Level) {
    const capped: Level = level === 'manage' && s.bundleCeiling === 'view' ? 'view' : level;
    setDrafts((d) => ({ ...d, [b.id]: { ...(d[b.id] ?? {}), [s.id]: capped } }));
  }

  const dirtyIds = Object.keys(drafts).filter((id) => {
    const b = matrix?.bundles.find((x) => x.id === id);
    if (!b) return false;
    return Object.entries(drafts[id]).some(([sid, l]) => (b.levels[sid] ?? 'none') !== l);
  });

  async function saveAll() {
    if (!matrix) return;
    setSaving(true);
    try {
      for (const id of dirtyIds) {
        const b = matrix.bundles.find((x) => x.id === id)!;
        const levels: Record<string, Level> = {};
        for (const s of matrix.sections) levels[s.id] = levelOf(b, s.id);
        await send(`/api/sections/bundles/${id}`, 'PATCH', { levels });
      }
      setDrafts({});
      await load();
      notify(dirtyIds.length === 1 ? 'Bundle saved' : `${dirtyIds.length} bundles saved`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to save', 'error');
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
  if (!matrix) {
    return <p role="status" className="px-6 py-8 text-size-ui text-muted-foreground">Loading section access…</p>;
  }

  const { canEdit, bundles } = matrix;

  return (
    <div>
      <div className={styles.toolbar}>
        <p className="mr-auto max-w-3xl text-size-ui text-muted-foreground">
          <strong className="font-medium text-[var(--foreground)]">Custom roles</strong> set every section exactly, starting from a built-in role.{' '}
          <strong className="font-medium text-[var(--foreground)]">Bundles</strong> add sections on top of whatever role a person has.
          {canEdit ? ' Change the columns here, then choose who has each one (or open a person in People).' : ' Only platform admins can change these.'}{' '}
          Data Estate actions stay with platform admins either way.
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing('new-bundle')} className={cn(styles.secondaryButton, 'gap-2 text-size-ui')}>
              <Layers className="h-4 w-4" />
              New bundle
            </Button>
            <Button onClick={() => setEditing('new-role')} className={cn(styles.primary, 'gap-2 text-size-ui')}>
              <Plus className="h-4 w-4" />
              New role
            </Button>
          </div>
        )}
      </div>

      {dirtyIds.length > 0 && (
        <div className={styles.saveBar} role="status">
          <span>Unsaved changes in {dirtyIds.length === 1 ? '1 bundle' : `${dirtyIds.length} bundles`}</span>
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
              <th scope="col" className={styles.matrixSection}>Section</th>
              {ROLE_COLUMNS.map((r) => (
                <th key={r.key} scope="col">{r.label}</th>
              ))}
              {bundles.map((b) => (
                <th key={b.id} scope="col" className={styles.bundleHead}>
                  <div className="flex items-center justify-center gap-1">
                    {b.kind === 'role' ? (
                      <Shield aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" />
                    ) : (
                      <Layers aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--brand-a-ink)]" />
                    )}
                    <span className="truncate" title={b.description ?? b.name}>{b.name}</span>
                  </div>
                  <div className="mt-0.5 text-caption font-normal text-muted-foreground">
                    {b.kind === 'role' && b.base ? `Role · from ${BASE_LABEL[b.base]}` : 'Bundle · adds'}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <button
                      type="button"
                      className={styles.bundleAction}
                      onClick={() => setMembersOf(b)}
                      title={canEdit ? `Choose who has this ${b.kind === 'role' ? 'role' : 'bundle'}` : `Who has this ${b.kind === 'role' ? 'role' : 'bundle'}`}
                    >
                      <UsersIcon aria-hidden className="h-3 w-3" />
                      {b.members.length}
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" className={styles.bundleAction} onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`} title="Rename or describe">
                          <Pencil aria-hidden className="h-3 w-3" />
                        </button>
                        <button type="button" className={styles.bundleAction} onClick={() => setDeleting(b)} aria-label={`Delete ${b.name}`} title="Delete">
                          <Trash2 aria-hidden className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => (
              <GroupRows
                key={g.group}
                label={g.label}
                sections={g.sections}
                bundles={bundles}
                canEdit={canEdit}
                levelOf={levelOf}
                setLevel={setLevel}
              />
            ))}
          </tbody>
        </table>
      </div>

      {bundles.length === 0 && (
        <p className="px-6 py-4 text-size-ui text-muted-foreground">
          No custom roles or bundles yet.{' '}
          {canEdit ? 'Create a role such as "Analyst" (Member without Dashboards), or a bundle such as "Cost viewers" that adds a section for a few people.' : ''}
        </p>
      )}
      <p className="border-t border-[var(--estate-border)] px-6 py-3 text-caption text-muted-foreground">
        Rows marked &ldquo;not switched on yet&rdquo; keep today&apos;s behaviour for everyone; bundle levels on them take effect once they are switched on.
      </p>

      {editing && (
        <BundleDialog
          bundle={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? (editing === 'new-role' ? 'role' : 'bundle') : editing.kind}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await load();
            notify(msg);
          }}
          notifyError={(m) => notify(m, 'error')}
        />
      )}
      {membersOf && (
        <MembersDialog
          bundle={membersOf}
          users={users}
          canEdit={canEdit}
          onClose={() => setMembersOf(null)}
          onSaved={async (msg) => {
            setMembersOf(null);
            await load();
            onMembersChanged();
            notify(msg);
          }}
          notifyError={(m) => notify(m, 'error')}
        />
      )}
      {deleting && (
        <DeleteDialog
          bundle={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            const name = deleting.name;
            setDeleting(null);
            setDrafts((d) => {
              const next = { ...d };
              delete next[deleting.id];
              return next;
            });
            await load();
            onMembersChanged();
            notify(`Deleted ${name}`);
          }}
          notifyError={(m) => notify(m, 'error')}
        />
      )}
    </div>
  );
}

function GroupRows({ label, sections, bundles, canEdit, levelOf, setLevel }: {
  label: string;
  sections: SectionInfo[];
  bundles: Bundle[];
  canEdit: boolean;
  levelOf: (b: Bundle, sectionId: string) => Level;
  setLevel: (b: Bundle, s: SectionInfo, level: Level) => void;
}) {
  const groupValue = (b: Bundle): Level | '' => {
    const ls = new Set(sections.map((s) => levelOf(b, s.id)));
    return ls.size === 1 ? [...ls][0] : '';
  };
  return (
    <>
      <tr className={styles.groupRow}>
        <th scope="rowgroup" colSpan={1 + ROLE_COLUMNS.length} className="text-left">
          {label}
        </th>
        {bundles.map((b) => (
          <td key={b.id}>
            {canEdit ? (
              <select
                aria-label={`${b.name}: set every ${label} section`}
                className={styles.cellSelect}
                value={groupValue(b)}
                onChange={(e) => {
                  const v = e.target.value as Level;
                  if (v) for (const s of sections) setLevel(b, s, v);
                }}
              >
                <option value="">Mixed</option>
                <option value="none">All: no access</option>
                <option value="view">All: view</option>
                <option value="manage">All: manage</option>
              </select>
            ) : null}
          </td>
        ))}
      </tr>
      {sections.map((s) => (
        <tr key={s.id}>
          <th scope="row" className={styles.matrixSection}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.label}</span>
              {!s.enforced && <span className={styles.pendingTag}>not switched on yet</span>}
              {s.platformAdminActionsOnly && <span className={styles.pendingTag}>actions: platform admins</span>}
            </div>
            <div className="mt-0.5 text-caption text-muted-foreground">
              View: {s.view}
              {s.manage ? <> · Manage: {s.manage}</> : null}
            </div>
          </th>
          {ROLE_COLUMNS.map((r) => (
            <td key={r.key}>
              <LevelChip level={roleLevel(s, r.key)} muted={!s.enforced} />
            </td>
          ))}
          {bundles.map((b) => {
            const level = levelOf(b, s.id);
            return (
              <td key={b.id} className={styles.bundleCell}>
                {canEdit ? (
                  <select
                    aria-label={`${b.name}: ${s.label}`}
                    className={styles.cellSelect}
                    value={level}
                    onChange={(e) => setLevel(b, s, e.target.value as Level)}
                  >
                    <option value="none">—</option>
                    <option value="view">View</option>
                    <option value="manage" disabled={s.bundleCeiling === 'view'}>
                      {s.bundleCeiling === 'view' ? 'Manage (not allowed)' : 'Manage'}
                    </option>
                  </select>
                ) : (
                  <LevelChip level={level} />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function BundleDialog({ bundle, kind, onClose, onSaved, notifyError }: {
  bundle: Bundle | null;
  kind: 'role' | 'bundle';
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  notifyError: (msg: string) => void;
}) {
  const [name, setName] = useState(bundle?.name ?? '');
  const [description, setDescription] = useState(bundle?.description ?? '');
  const [base, setBase] = useState<DefaultRole>(bundle?.base ?? 'member');
  const [busy, setBusy] = useState(false);
  const noun = kind === 'role' ? 'role' : 'bundle';
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (bundle) {
        await send(`/api/sections/bundles/${bundle.id}`, 'PATCH', {
          name: name.trim(),
          description: description.trim() || null,
          ...(kind === 'role' && base !== bundle.base ? { base } : {}),
        });
        await onSaved(kind === 'role' ? 'Role updated' : 'Bundle updated');
      } else {
        await send('/api/sections/bundles', 'POST', {
          kind,
          name: name.trim(),
          description: description.trim() || undefined,
          ...(kind === 'role' ? { base } : {}),
        });
        await onSaved(
          kind === 'role'
            ? `Created ${name.trim()} from ${BASE_LABEL[base]}. Adjust its sections in the matrix, then add people.`
            : `Created ${name.trim()}. Set its sections in the matrix, then add people.`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <UserDialogContent open labelledBy="bundle-dialog-title">
        <DialogHeader className={cn(styles.dialogHeader, '!mb-0')}>
          <DialogTitle id="bundle-dialog-title" className="text-title-section">{bundle ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          <DialogDescription className="text-size-ui">
            {kind === 'role'
              ? 'A custom role sets every section exactly, and can take access away. It starts from a built-in role, which also decides everything outside sections.'
              : 'A bundle adds sections on top of a person’s role. It never removes access.'}
          </DialogDescription>
        </DialogHeader>
        <div className={styles.formBody}>
          <div>
            <label htmlFor="bundle-name" className="mb-2 block text-size-ui font-medium">Name</label>
            <input id="bundle-name" className={styles.input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={kind === 'role' ? 'Analyst' : 'Cost viewers'} autoFocus />
          </div>
          {kind === 'role' && (
            <div>
              <label htmlFor="bundle-base" className="mb-2 block text-size-ui font-medium">Start from</label>
              <select id="bundle-base" className={styles.input} value={base} onChange={(e) => setBase(e.target.value as DefaultRole)}>
                <option value="readonly">Read only</option>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <p className="mt-1 text-caption text-muted-foreground">
                {bundle
                  ? 'Changing this moves everyone with the role to the new starting role. Section levels stay as set.'
                  : 'The new role copies this role’s sections. Change any of them in the matrix afterwards.'}
              </p>
            </div>
          )}
          <div>
            <label htmlFor="bundle-description" className="mb-2 block text-size-ui font-medium">What it is for (optional)</label>
            <input id="bundle-description" className={styles.input} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'role' ? 'Analysts: Inspector and Agents, no dashboards' : 'Finance team: see spend, no changes'} />
          </div>
          {error && <div role="alert" className="text-size-ui text-red-600 dark:text-red-400">{error}</div>}
        </div>
        <DialogFooter className={styles.dialogFooter}>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy} className={cn(styles.secondaryButton, 'text-size-ui')}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || name.trim().length < 2} className={cn(styles.primary, 'gap-2 text-size-ui')}>
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : bundle ? 'Save' : `Create ${noun}`}
          </Button>
        </DialogFooter>
      </UserDialogContent>
    </Dialog>
  );
}

function MembersDialog({ bundle, users, canEdit, onClose, onSaved, notifyError }: {
  bundle: Bundle;
  users: UserRow[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  notifyError: (msg: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(bundle.members.map((m) => m.id)));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string | null; email: string; role?: string }>();
    // Platform admins already have everything; a custom role is never given to them.
    for (const u of users) {
      if (bundle.kind === 'role' && u.primaryRole === 'platform_admin') continue;
      byId.set(u.id, { id: u.id, name: u.name, email: u.email, role: u.roleLabel });
    }
    for (const m of bundle.members) if (!byId.has(m.id)) byId.set(m.id, m);
    // Current members first (as of opening), so ticking a box does not reshuffle the list.
    const initial = new Set(bundle.members.map((m) => m.id));
    const needle = q.trim().toLowerCase();
    return [...byId.values()]
      .filter((p) => !needle || p.email.toLowerCase().includes(needle) || (p.name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id)) || (a.name ?? a.email).localeCompare(b.name ?? b.email));
  }, [users, bundle.members, q]);

  async function save() {
    setBusy(true);
    try {
      await send(`/api/sections/bundles/${bundle.id}/members`, 'PUT', { userIds: [...selected] });
      await onSaved(`Updated who has ${bundle.name}`);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <UserDialogContent open labelledBy="bundle-members-title">
        <DialogHeader className={cn(styles.dialogHeader, '!mb-0')}>
          <DialogTitle id="bundle-members-title" className="text-title-section">People with {bundle.name}</DialogTitle>
          <DialogDescription className="text-size-ui">
            {canEdit
              ? bundle.kind === 'role'
                ? `${selected.size} selected. Ticking someone replaces their role with ${bundle.name} (based on ${bundle.base ? BASE_LABEL[bundle.base] : 'its base'}); unticking leaves them on ${bundle.base ? BASE_LABEL[bundle.base] : 'the base role'}. Bundles stay.`
                : `${selected.size} selected. Changes apply on each person's next page load.`
              : `${bundle.members.length} people have this ${bundle.kind === 'role' ? 'role' : 'bundle'}.`}
          </DialogDescription>
        </DialogHeader>
        <div className={styles.formBody}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={cn(styles.input, '!pl-10')} placeholder="Search name or email…" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className={styles.memberList}>
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-size-ui">{p.name || p.email}</span>
                    {p.name && <span className="block truncate text-caption text-muted-foreground">{p.email}</span>}
                  </span>
                  {'role' in p && p.role ? <span className="text-caption text-muted-foreground">{p.role}</span> : null}
                </label>
              </li>
            ))}
            {people.length === 0 && <li className="px-3 py-2 text-size-ui text-muted-foreground">No one matches.</li>}
          </ul>
        </div>
        <DialogFooter className={styles.dialogFooter}>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy} className={cn(styles.secondaryButton, 'text-size-ui')}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => void save()} disabled={busy} className={cn(styles.primary, 'gap-2 text-size-ui')}>
              {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </UserDialogContent>
    </Dialog>
  );
}

function DeleteDialog({ bundle, onClose, onDeleted, notifyError }: {
  bundle: Bundle;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
  notifyError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await send(`/api/sections/bundles/${bundle.id}`, 'DELETE');
      await onDeleted();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <UserDialogContent open labelledBy="bundle-delete-title">
        <DialogHeader className={cn(styles.dialogHeader, '!mb-0')}>
          <DialogTitle id="bundle-delete-title" className="text-title-section">Delete {bundle.name}?</DialogTitle>
          <DialogDescription className="text-size-ui">
            {bundle.kind === 'role'
              ? bundle.members.length
                ? `${bundle.members.length} ${bundle.members.length === 1 ? 'person goes' : 'people go'} back to the ${bundle.base ? BASE_LABEL[bundle.base] : 'base'} defaults.`
                : 'No one has this role.'
              : bundle.members.length
                ? `${bundle.members.length} ${bundle.members.length === 1 ? 'person loses' : 'people lose'} the sections this bundle gave them. Their role stays the same.`
                : 'No one has this bundle.'}{' '}
            This cannot be undone; the audit log keeps a record.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className={styles.dialogFooter}>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy} className={cn(styles.secondaryButton, 'text-size-ui')}>Cancel</Button>
          <Button size="sm" onClick={() => void confirm()} disabled={busy} className={cn(styles.danger, 'gap-2 text-size-ui')}>
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Deleting…</> : `Delete ${bundle.kind === 'role' ? 'role' : 'bundle'}`}
          </Button>
        </DialogFooter>
      </UserDialogContent>
    </Dialog>
  );
}
