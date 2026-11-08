/**
 * Admin helpers for the simplified model's Data tab: who uses each catalog / schema / table
 * (access rules, direct and inherited), which protections apply (direct and inherited), and how many
 * protected columns a table has. Reads the new tables only.
 */
import { prisma } from '@/lib/db';
import { BUILTIN_GROUPS, covers } from './engine';

export type HolderType = 'person' | 'group' | 'builtin';
export type RuleAccess = 'use' | 'export' | 'block';

export interface NodeRule {
  id: string;
  holderType: HolderType;
  holderId: string;
  holderName: string;
  access: RuleAccess;
  autoApprove: boolean;
  expiresAt: string | null;
  /** Path the rule is set on (this node, or a parent for inherited rules). */
  from: string;
}

export interface NodeProtection {
  id: string;
  tagId: string;
  name: string;
  from: string;
}

export interface NodeAccessInfo {
  rules: NodeRule[];
  inheritedRules: NodeRule[];
  protections: NodeProtection[];
  inheritedProtections: NodeProtection[];
  protectedColumns: number;
}

export interface AccessAdminData {
  rules: { id: string; holder_type: string; holder_id: string; path: string; effect: string; allow_export: boolean; auto_approve: boolean; expires_at: Date | null }[];
  pathProtections: { id: string; tag_id: string; path: string }[];
  tagNames: Map<string, string>;
  columnCounts: Map<string, number>;
  holderName: (type: string, id: string) => string;
}

const BUILTIN_NAME = new Map<string, string>(BUILTIN_GROUPS.map((b) => [b.id, b.name]));

export async function loadAccessAdminData(orgId: string): Promise<AccessAdminData> {
  const [rules, pathProtections, tags, groups, columnTags] = await Promise.all([
    prisma.accessRule.findMany({ where: { org_id: orgId } }),
    prisma.accessPathProtection.findMany({ where: { org_id: orgId }, select: { id: true, tag_id: true, path: true } }),
    prisma.accessTag.findMany({ where: { org_id: orgId, archived_at: null }, select: { id: true, name: true } }),
    prisma.accessGroup.findMany({ where: { org_id: orgId }, select: { id: true, name: true, archived_at: true } }),
    prisma.accessColumnTag.groupBy({ by: ['table_path'], where: { org_id: orgId, status: 'confirmed' }, _count: { _all: true } }),
  ]);
  const personIds = [...new Set(rules.filter((r) => r.holder_type === 'person').map((r) => r.holder_id))];
  const people = personIds.length
    ? await prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, email: true } })
    : [];
  const tagNames = new Map(tags.map((t) => [t.id, t.name]));
  const groupName = new Map(groups.map((g) => [g.id, g.archived_at ? `${g.name} (archived)` : g.name]));
  const personName = new Map(people.map((p) => [p.id, p.name?.trim() || p.email]));
  const holderName = (type: string, id: string) =>
    type === 'builtin'
      ? (BUILTIN_NAME.get(id) ?? `Role: ${id}`)
      : type === 'group'
        ? (groupName.get(id) ?? 'Unknown group')
        : (personName.get(id) ?? 'Unknown person');
  return {
    rules: rules.filter((r) => r.holder_type !== 'group' || groups.some((g) => g.id === r.holder_id && !g.archived_at)),
    pathProtections: pathProtections.filter((p) => tagNames.has(p.tag_id)),
    tagNames,
    columnCounts: new Map(columnTags.map((c) => [c.table_path, c._count._all])),
    holderName,
  };
}

function toNodeRule(data: AccessAdminData, r: AccessAdminData['rules'][number]): NodeRule {
  return {
    id: r.id,
    holderType: r.holder_type as HolderType,
    holderId: r.holder_id,
    holderName: data.holderName(r.holder_type, r.holder_id),
    access: r.effect === 'block' ? 'block' : r.allow_export ? 'export' : 'use',
    autoApprove: r.auto_approve,
    expiresAt: r.expires_at?.toISOString() ?? null,
    from: r.path,
  };
}

/** Direct and inherited rules and protections for one node. */
export function nodeAccessInfo(data: AccessAdminData, path: string): NodeAccessInfo {
  const p = path.toLowerCase();
  const rules: NodeRule[] = [];
  const inheritedRules: NodeRule[] = [];
  for (const r of data.rules) {
    if (r.path === p) rules.push(toNodeRule(data, r));
    else if (covers(r.path, p)) inheritedRules.push(toNodeRule(data, r));
  }
  const protections: NodeProtection[] = [];
  const inheritedProtections: NodeProtection[] = [];
  for (const pp of data.pathProtections) {
    const row = { id: pp.id, tagId: pp.tag_id, name: data.tagNames.get(pp.tag_id) ?? '…', from: pp.path };
    if (pp.path === p) protections.push(row);
    else if (covers(pp.path, p)) inheritedProtections.push(row);
  }
  let protectedColumns = 0;
  for (const [table, n] of data.columnCounts) if (covers(p, table)) protectedColumns += n;
  return { rules, inheritedRules, protections, inheritedProtections, protectedColumns };
}

/** Paths that carry rules or protections, so the tree shows them even when not harvested. */
export function adminPolicyPaths(data: AccessAdminData): string[] {
  return [...data.rules.map((r) => r.path), ...data.pathProtections.map((p) => p.path)];
}
