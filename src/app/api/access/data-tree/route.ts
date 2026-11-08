import { handle, ok, ApiError } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { requireAccessAdmin } from '@/lib/access/admin-api';
import { listEstateChildren, searchEstateTables } from '@/lib/access/estate-tree';
import { normalizeCatalogPath } from '@/lib/access/paths';
import { adminPolicyPaths, loadAccessAdminData, nodeAccessInfo } from '@/lib/access/rules-admin';
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

  if (q && url.searchParams.get('by') === 'meaning') {
    // Tables whose meaning matches (embeddings of table summaries; no values).
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
        access: nodeAccessInfo(data, h.path),
      })),
    });
  }

  const { nodes, truncated } = q
    ? { nodes: await searchEstateTables(orgId, q), truncated: false }
    : await listEstateChildren(orgId, parent, adminPolicyPaths(data));

  return ok({
    parent,
    truncated,
    nodes: nodes.map((n) => ({ ...n, access: nodeAccessInfo(data, n.path) })),
  });
});
