/**
 * Catalog › schema › table children for the Data access console.
 *
 * Reads harvested objects (`platform_context_objects`, lifecycle active) and adds
 * paths that only exist in policy (a grant or label on a catalog that has not been
 * harvested), so an admin can always see and undo what is stored.
 */
import { prisma } from '@/lib/db';
import { withAccessDbRetry } from './guards';
import type { PolicySnapshot } from './types';

export type EstateNodeKind = 'catalog' | 'schema' | 'table' | 'view';

export interface EstateNode {
  path: string;
  name: string;
  depth: 1 | 2 | 3;
  kind: EstateNodeKind;
  /** Schemas in a catalog, tables in a schema. Null for tables and policy-only rows. */
  childCount: number | null;
  /** Tables below this node. Null for policy-only rows. */
  tableCount: number | null;
  /** False when the path is only known from a grant or label. */
  inEstate: boolean;
}

const KIND_BY_DEPTH: Record<1 | 2, EstateNodeKind> = { 1: 'catalog', 2: 'schema' };
const MAX_TABLES = 2000;
const MAX_SEARCH = 60;

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Paths that carry policy (grants, labels, rules, protections) even if the estate has no such object. */
export function snapshotPolicyPaths(policy: PolicySnapshot): string[] {
  return [...policy.grants.map((g) => g.path), ...policy.labels.map((l) => l.path)];
}

function policyPathsAt(policyPaths: string[], parent: string | null, depth: number): string[] {
  const out = new Set<string>();
  const prefix = parent ? `${parent}.` : '';
  for (const p of policyPaths) {
    const parts = p.split('.');
    if (parts.length < depth) continue;
    const candidate = parts.slice(0, depth).join('.');
    if (parent && !candidate.startsWith(prefix)) continue;
    out.add(candidate);
  }
  return [...out];
}

export async function listEstateChildren(
  orgId: string,
  parent: string | null,
  policyPaths: string[],
): Promise<{ nodes: EstateNode[]; truncated: boolean }> {
  const parentParts = parent ? parent.split('.') : [];
  const depth = (parentParts.length + 1) as 1 | 2 | 3;
  const nodes = new Map<string, EstateNode>();
  let truncated = false;

  const base = { org_id: orgId, lifecycle: 'active' } as const;

  if (depth <= 2) {
    const where =
      depth === 1
        ? { ...base, catalog_name: { not: null } }
        : { ...base, catalog_name: { equals: parentParts[0], mode: 'insensitive' as const } };
    const groups = await withAccessDbRetry(() =>
      prisma.platformContextObject.groupBy({
        by: ['catalog_name', 'schema_name'],
        where,
        _count: { _all: true },
      }),
    );
    for (const row of groups) {
      const catalog = lower(row.catalog_name);
      const schema = lower(row.schema_name);
      if (!catalog) continue;
      if (depth === 2 && !schema) continue;
      const path = depth === 1 ? catalog : `${catalog}.${schema}`;
      const name = depth === 1 ? row.catalog_name!.trim() : row.schema_name!.trim();
      const existing = nodes.get(path);
      const tables = row._count._all;
      if (existing) {
        existing.tableCount = (existing.tableCount ?? 0) + tables;
        if (depth === 1 && schema) existing.childCount = (existing.childCount ?? 0) + 1;
        else if (depth === 2) existing.childCount = existing.tableCount;
      } else {
        nodes.set(path, {
          path,
          name,
          depth,
          kind: KIND_BY_DEPTH[depth as 1 | 2],
          childCount: depth === 1 ? (schema ? 1 : 0) : tables,
          tableCount: tables,
          inEstate: true,
        });
      }
    }
  } else {
    const rows = await withAccessDbRetry(() =>
      prisma.platformContextObject.findMany({
        where: {
          ...base,
          catalog_name: { equals: parentParts[0], mode: 'insensitive' },
          schema_name: { equals: parentParts[1], mode: 'insensitive' },
        },
        select: { object_name: true, object_kind: true },
        orderBy: { object_name: 'asc' },
        take: MAX_TABLES + 1,
      }),
    );
    truncated = rows.length > MAX_TABLES;
    for (const row of rows.slice(0, MAX_TABLES)) {
      const name = row.object_name?.trim();
      if (!name) continue;
      const path = `${parent}.${name.toLowerCase()}`;
      if (nodes.has(path)) continue;
      nodes.set(path, {
        path,
        name,
        depth: 3,
        kind: row.object_kind === 'view' ? 'view' : 'table',
        childCount: null,
        tableCount: null,
        inEstate: true,
      });
    }
  }

  for (const path of policyPathsAt(policyPaths, parent, depth)) {
    if (nodes.has(path)) continue;
    nodes.set(path, {
      path,
      name: path.split('.').pop()!,
      depth,
      kind: depth === 1 ? 'catalog' : depth === 2 ? 'schema' : 'table',
      childCount: null,
      tableCount: null,
      inEstate: false,
    });
  }

  const list = [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { nodes: list, truncated };
}

/** Tables and views whose path contains the query (case-insensitive). */
export async function searchEstateTables(orgId: string, query: string): Promise<EstateNode[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await withAccessDbRetry(() =>
    prisma.platformContextObject.findMany({
      where: {
        org_id: orgId,
        lifecycle: 'active',
        catalog_name: { not: null },
        schema_name: { not: null },
        full_path: { contains: q, mode: 'insensitive' },
      },
      select: { catalog_name: true, schema_name: true, object_name: true, object_kind: true },
      orderBy: { full_path: 'asc' },
      take: MAX_SEARCH,
    }),
  );
  const seen = new Set<string>();
  const out: EstateNode[] = [];
  for (const r of rows) {
    if (!r.object_name) continue;
    const path = `${lower(r.catalog_name)}.${lower(r.schema_name)}.${lower(r.object_name)}`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      name: path,
      depth: 3,
      kind: r.object_kind === 'view' ? 'view' : 'table',
      childCount: null,
      tableCount: null,
      inEstate: true,
    });
  }
  return out;
}
