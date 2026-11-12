'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Layers, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  SECTIONS,
  SECTION_GROUP_LABEL,
  keysForLevels,
  resolveSectionLevels,
  roleBaseKey,
  roleDefaultKeysFor,
  type DefaultRole,
  type SectionLevel,
} from '@/lib/sections/registry';
import { sectionUseGaps } from '@/lib/sections/uses';
import type { UserRow } from './UserTable';
import styles from './users.module.css';

interface Option {
  id: string;
  name: string;
  description: string | null;
  kind: 'role' | 'bundle';
  base: DefaultRole | null;
  levels: Record<string, SectionLevel>;
}

const BASE_LABEL: Record<DefaultRole, string> = { readonly: 'Read only', member: 'Member', admin: 'Admin' };
const LEVEL_WORD: Record<SectionLevel, string> = { none: 'No access', view: 'View', manage: 'Manage' };

/**
 * Person drawer → Section access (platform admins only): pick a custom role and tick bundles for one
 * person, with a preview of what changes. Saves through PUT /api/users/[id]/section-access.
 */
export function PersonSectionAccess({ user, onSaved, notify }: {
  user: UserRow;
  onSaved: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [roleOverrides, setRoleOverrides] = useState<Partial<Record<DefaultRole, Record<string, SectionLevel>>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customRoleId, setCustomRoleId] = useState<string>(user.customRole?.id ?? '');
  const [bundleIds, setBundleIds] = useState<Set<string>>(() => new Set((user.bundles ?? []).map((b) => b.id)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.resolve().then(async () => {
      try {
        const res = await fetch('/api/sections', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { bundles: Option[]; roleOverrides?: Partial<Record<DefaultRole, Record<string, SectionLevel>>> };
        if (live) {
          setOptions(data.bundles);
          setRoleOverrides(data.roleOverrides ?? {});
        }
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : 'Could not load roles and bundles');
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const roles = (options ?? []).filter((o) => o.kind === 'role');
  const bundles = (options ?? []).filter((o) => o.kind === 'bundle');
  const isPlatformAdmin = user.primaryRole === 'platform_admin';
  const chosenRole = roles.find((r) => r.id === customRoleId) ?? null;

  // What the person would get: the custom role (or their built-in role) plus the ticked bundles.
  const { rows: preview, gaps } = (() => {
    if (!options) return { rows: [], gaps: [] };
    const keys: string[] = [];
    if (chosenRole?.base) keys.push(roleBaseKey(chosenRole.base), ...keysForLevels(chosenRole.levels));
    for (const b of bundles) if (bundleIds.has(b.id)) keys.push(...keysForLevels(b.levels));
    const baseRole = chosenRole?.base ?? user.primaryRole;
    // Without a custom role, the built-in role's defaults apply, including any changed in the matrix.
    if (!chosenRole && (baseRole === 'readonly' || baseRole === 'member' || baseRole === 'admin')) {
      keys.push(...roleDefaultKeysFor(baseRole, roleOverrides[baseRole] ?? {}));
    }
    const levels = resolveSectionLevels([baseRole], keys);
    return {
      rows: SECTIONS.filter((s) => s.enforced).map((s) => ({ id: s.id, label: `${SECTION_GROUP_LABEL[s.group]} → ${s.label}`, level: levels[s.id] })),
      gaps: sectionUseGaps(levels),
    };
  })();

  const dirty =
    customRoleId !== (user.customRole?.id ?? '') ||
    bundleIds.size !== (user.bundles ?? []).length ||
    (user.bundles ?? []).some((b) => !bundleIds.has(b.id));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${user.id}/section-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customRoleId: customRoleId || null, bundleIds: [...bundleIds] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Save failed (${res.status})`);
      }
      notify(`Updated section access for ${user.name || user.email}`);
      onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.detailSection}>
      <div className="mb-2 flex items-center gap-2 text-title-card">
        <Layers className="h-4 w-4 text-muted-foreground" />
        Section access
      </div>
      <p className="mb-4 text-caption text-muted-foreground">
        Which parts of ALOFT this person can open. A custom role replaces their role&apos;s defaults; bundles add on top.
      </p>

      {isPlatformAdmin ? (
        <p className="text-size-ui text-muted-foreground">Platform admins can open and change every section already.</p>
      ) : loadError ? (
        <p role="alert" className="text-size-ui text-red-600 dark:text-red-400">{loadError}</p>
      ) : options === null ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor={`custom-role-${user.id}`} className="mb-2 block text-size-ui font-medium">Custom role</label>
            <select
              id={`custom-role-${user.id}`}
              className={styles.input}
              value={customRoleId}
              onChange={(e) => setCustomRoleId(e.target.value)}
            >
              <option value="">None (use {user.customRole ? BASE_LABEL[user.customRole.base] : user.roleLabel} defaults)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (from {r.base ? BASE_LABEL[r.base] : '?'})
                </option>
              ))}
            </select>
            {roles.length === 0 && (
              <p className="mt-1 text-caption text-muted-foreground">No custom roles yet. Create one in the Section access tab.</p>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-size-ui font-medium">Bundles</legend>
            {bundles.length === 0 ? (
              <p className="text-caption text-muted-foreground">No bundles yet. Create one in the Section access tab.</p>
            ) : (
              <ul className={styles.memberList}>
                {bundles.map((b) => (
                  <li key={b.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={bundleIds.has(b.id)}
                        onChange={(e) =>
                          setBundleIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(b.id);
                            else next.delete(b.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-size-ui">{b.name}</span>
                        {b.description && <span className="block truncate text-caption text-muted-foreground">{b.description}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {gaps.length > 0 && (
            <ul className={cn(styles.depNotice, "!mx-0")} aria-label="Sections that depend on other sections">
              {gaps.map((g) => (
                <li key={g.use.id} className={styles.depItem}>
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
                  <span>{g.message} Add a bundle that gives it, or change their role.</span>
                </li>
              ))}
            </ul>
          )}

          <details>
            <summary className="cursor-pointer text-size-ui font-medium">What they would get</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {preview.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 text-caption">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className={cn(styles.levelChip, styles[`level_${p.level}`])}>{p.level === 'none' ? '—' : LEVEL_WORD[p.level]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-muted-foreground">Sections not switched on yet are left out; they keep today&apos;s behaviour.</p>
          </details>

          <div>
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} className={cn(styles.primary, 'gap-2 text-size-ui')}>
              {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save section access'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
