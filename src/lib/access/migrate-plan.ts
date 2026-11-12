/**
 * Pure mapping from today's access rows to the simplified model's rows (S2; doc §5).
 * Used by scripts/access/simplified-model-migrate.ts to write, and by tests to prove that
 * copy → load (model-store) → decide gives everyone exactly today's access.
 *
 *   department            → group (same members), owned by the approver
 *   grant                 → rule (discover dropped; export → Use + allow_export; deny → Block)
 *   label                 → protection "Confidential" / "Restricted" on the path
 *   clearance             → protection grant to the person (Restricted also gets Confidential)
 */
import type { AccessModelRows } from './model-store';

export interface CurrentRows {
  departments: { id: string; key: string; name: string; archived_at: Date | null }[];
  departmentMembers: { department_id: string; user_id: string }[];
  grants: {
    id: string;
    principal_type: string;
    principal_id: string;
    path: string;
    path_depth: number;
    level: string;
    effect: string;
    expires_at: Date | null;
  }[];
  labels: { id: string; path: string; path_depth: number; label: string }[];
  clearances: { user_id: string; level: string; expires_at: Date | null }[];
}

export const LABEL_TAG_KEYS = { confidential: 'confidential', restricted: 'restricted' } as const;
export const LABEL_TAG_NAMES = { confidential: 'Confidential', restricted: 'Restricted' } as const;

/** Stable ids for rows the copy creates, so callers can map them to real ids on insert. */
export const groupIdForDepartment = (departmentId: string) => `dept:${departmentId}`;
export const tagIdForLabel = (label: 'confidential' | 'restricted') => `label:${label}`;

export interface CopyPlan {
  groups: { id: string; departmentId: string; key: string; name: string; archived_at: Date | null }[];
  members: { group_id: string; user_id: string }[];
  rules: (AccessModelRows['rules'][number] & { grantId: string; path_depth: number })[];
  droppedDiscoverGrantIds: string[];
  tags: { id: string; key: string; name: string }[];
  pathProtections: { tag_id: string; path: string; path_depth: number; labelId: string }[];
  tagGrants: { tag_id: string; principal_type: 'user'; principal_id: string; level: 'full'; expires_at: Date | null }[];
}

export function planCopy(cur: CurrentRows): CopyPlan {
  const groups = cur.departments.map((d) => ({
    id: groupIdForDepartment(d.id),
    departmentId: d.id,
    key: d.key,
    name: d.name,
    archived_at: d.archived_at,
  }));
  const members = cur.departmentMembers.map((m) => ({ group_id: groupIdForDepartment(m.department_id), user_id: m.user_id }));

  const rules: CopyPlan['rules'] = [];
  const droppedDiscoverGrantIds: string[] = [];
  for (const g of cur.grants) {
    if (g.effect === 'allow' && g.level === 'discover') {
      droppedDiscoverGrantIds.push(g.id);
      continue;
    }
    rules.push({
      grantId: g.id,
      holder_type: g.principal_type === 'user' ? 'person' : g.principal_type === 'department' ? 'group' : 'builtin',
      holder_id: g.principal_type === 'department' ? groupIdForDepartment(g.principal_id) : g.principal_id,
      path: g.path.toLowerCase(),
      path_depth: g.path_depth,
      effect: g.effect === 'deny' ? 'block' : 'use',
      allow_export: g.effect === 'allow' && g.level === 'export',
      expires_at: g.expires_at,
    });
  }

  const usedLabels = new Set<'confidential' | 'restricted'>();
  const pathProtections: CopyPlan['pathProtections'] = [];
  for (const l of cur.labels) {
    const label = l.label as 'confidential' | 'restricted';
    usedLabels.add(label);
    pathProtections.push({ tag_id: tagIdForLabel(label), path: l.path.toLowerCase(), path_depth: l.path_depth, labelId: l.id });
  }
  const tagGrants: CopyPlan['tagGrants'] = [];
  for (const c of cur.clearances) {
    if (c.level !== 'confidential' && c.level !== 'restricted') continue;
    for (const label of c.level === 'restricted' ? (['restricted', 'confidential'] as const) : (['confidential'] as const)) {
      usedLabels.add(label);
      tagGrants.push({ tag_id: tagIdForLabel(label), principal_type: 'user', principal_id: c.user_id, level: 'full', expires_at: c.expires_at });
    }
  }
  const tags = [...usedLabels].map((l) => ({ id: tagIdForLabel(l), key: LABEL_TAG_KEYS[l], name: LABEL_TAG_NAMES[l] }));

  return { groups, members, rules, droppedDiscoverGrantIds, tags, pathProtections, tagGrants };
}

/** True when copying would leave no rules although grants exist (all Discover-only): it would open data. */
export function copyWouldOpenData(cur: CurrentRows, plan: CopyPlan): boolean {
  return cur.grants.length > 0 && plan.rules.length === 0;
}

/**
 * The model rows the new tables would hold after the copy, merged with what is already in the
 * new tables (column protections, access groups, tag grants). Used to verify before writing.
 */
export function rowsAfterCopy(plan: CopyPlan, existing: AccessModelRows): AccessModelRows {
  return {
    rules: [...existing.rules, ...plan.rules],
    tags: [...existing.tags, ...plan.tags.map((t) => ({ id: t.id, name: t.name, key: t.key, archived_at: null }))],
    pathProtections: [...existing.pathProtections, ...plan.pathProtections],
    columnTags: existing.columnTags,
    tagGrants: [...existing.tagGrants, ...plan.tagGrants],
    groups: [...existing.groups, ...plan.groups.map((g) => ({ id: g.id, archived_at: g.archived_at }))],
    members: [...existing.members, ...plan.members.map((m) => ({ ...m, expires_at: null }))],
  };
}
