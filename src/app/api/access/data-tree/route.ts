import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { listEstateChildren, searchEstateTables } from '@/lib/access/estate-tree';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { adminPolicyPaths, loadAccessAdminData, nodeAccessInfo } from '@/lib/access/rules-admin';
import { mergeTableSearchHits } from '@/lib/access/table-search-hybrid';
import { rerankTableSearchHits } from '@/lib/access/table-search-rerank';
import { searchTablesByMeaning } from '@/lib/access/semantic-search';

export const dynamic = 'force-dynamic';

/**
 * The Data tab tree (simplified model): catalog → schema → table, each node with who can use it
 * (rules set here and inherited), protections (here and inherited) and its protected column count.
 *
 *   ?parent=<catalog | catalog.schema>   children (root when absent)
 *   ?q=<text>                            table search instead
 */
export const GET = handle(async (req) => {
  await requireAccessAdmin(req);
  const url = new URL(req.url);
  const parentRaw = url.searchParams.get('parent');
  const q = url.searchParams.get('q');
  const orgId = await getOrgId();
  const data = await loadAccessAdminData(orgId);

  const parent = parentRaw ? normalizeCatalogPath(parentRaw).path : null;
  if (parent && parent.split('.').length > 2) throw new ApiError(400, 'parent must be a catalog or schema');

  const by = url.searchParams.get('by');

  if (q && by === 'meaning') {
    const hits = await searchTablesByMeaning(orgId, q);
    return ok({
      parent: null,
      truncated: false,
      nodes: hits.map((h) => ({
        path: h.path,
        name: h.path.split('.')[2],
        depth: 3,
        kind: h.kind === 'view' ? 'view' : 'table',
        childCount: null,
        tableCount: null,
        inEstate: true,
        description: h.description,
        score: h.score,
        match: 'meaning' as const,
        access: nodeAccessInfo(data, h.path),
      })),
    });
  }

  if (q) {
    const nameTables = await searchEstateTables(orgId, q);
    const nameNodes = nameTables.map((n) => ({
      ...n,
      match: 'name' as const,
      access: nodeAccessInfo(data, n.path),
    }));

    if (by === 'name') {
      return ok({ parent: null, truncated: false, nodes: nameNodes });
    }

    const meaningHits = await searchTablesByMeaning(orgId, q).catch(() => []);
    let merged = mergeTableSearchHits(nameTables, meaningHits);
    merged = await rerankTableSearchHits(q, merged);
    const nodes = merged.map((n) => {
      const base = nameTables.find((t) => t.path === n.path);
      if (base) return { ...base, ...n, access: nodeAccessInfo(data, n.path) };
      return {
        path: n.path,
        name: n.path.split('.')[2],
        depth: 3 as const,
        kind: n.kind === 'view' ? ('view' as const) : ('table' as const),
        childCount: null,
        tableCount: null,
        inEstate: true,
        description: n.description,
        score: n.score,
        match: n.match,
        access: nodeAccessInfo(data, n.path),
      };
    });
    return ok({ parent: null, truncated: false, nodes });
  }

  const { nodes, truncated } = await listEstateChildren(orgId, parent, adminPolicyPaths(data));

  return ok({
    parent,
    truncated,
    nodes: nodes.map((n) => ({ ...n, access: nodeAccessInfo(data, n.path) })),
  });
});
