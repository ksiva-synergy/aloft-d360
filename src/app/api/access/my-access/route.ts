import { prisma } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { getOrgId } from '@/lib/databricks/connections';
import { resolveAuth } from '@/middleware/auth';
import { personAccessSummary } from '@/lib/access/person-summary';
import { searchEstateTables } from '@/lib/access/estate-tree';
import { searchTablesByMeaning } from '@/lib/access/semantic-search';

export const dynamic = 'force-dynamic';

/**
 * "My data access" for every signed-in person (simplified model):
 *   - what I can use and see, and through what (my own summary only)
 *   - the protections I could ask for (names only)
 *   - ?q=<text>: table names matching, to ask for a table. Names are visible to everyone (A1);
 *     values never are.
 */
export const GET = handle(async (req) => {
  const auth = await resolveAuth(req);
  const orgId = await getOrgId();
  const q = new URL(req.url).searchParams.get('q');

  if (q !== null) {
    if (q.trim().length < 2) return ok({ tables: [] });
    if (new URL(req.url).searchParams.get('by') === 'meaning') {
      const hits = await searchTablesByMeaning(orgId, q.trim());
      return ok({ tables: hits.map((h) => ({ path: h.path, kind: h.kind, description: h.description, match: 'meaning' })) });
    }
    const nodes = await searchEstateTables(orgId, q);
    return ok({ tables: nodes.map((n) => ({ path: n.path, kind: n.kind, match: 'name' })) });
  }

  const [summary, tags] = await Promise.all([
    personAccessSummary(orgId, auth.userId),
    prisma.accessTag.findMany({
      where: { org_id: orgId, archived_at: null },
      select: { id: true, name: true, description: true, requires_two_approvals: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const level = new Map(summary.protections.map((p) => [p.id, p.level]));
  return ok({
    me: { userId: auth.userId, roles: summary.roles },
    groups: summary.groups,
    builtins: summary.builtins,
    rules: summary.rules,
    protections: tags.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      twoApprovals: t.requires_two_approvals,
      myLevel: level.get(t.id) ?? 'none',
    })),
  });
});
