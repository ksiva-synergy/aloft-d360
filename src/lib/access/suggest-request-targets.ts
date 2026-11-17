/**
 * Infer which tables a person may need for an access request from natural language.
 * One Inspector denial is only one path; purpose text may imply several tables (hybrid + optional re-rank).
 */
import { mergeTableSearchHits } from '@/lib/access/table-search-hybrid';
import { searchEstateTables } from '@/lib/access/estate-tree';
import { searchTablesByMeaning } from '@/lib/access/semantic-search';
import { rerankTableSearchHits } from '@/lib/access/table-search-rerank';
import { friendlyDataLabel } from '@/lib/access/denial-ui';
import { personAccessSummary } from '@/lib/access/person-summary';
import { purposePhrases } from '@/lib/access/purpose-phrases';

export { purposePhrases } from '@/lib/access/purpose-phrases';

export type SuggestedTable = {
  path: string;
  kind: string;
  label: string;
  description?: string | null;
  match: 'name' | 'meaning';
  /** From denial or user selection — not necessarily the only table needed. */
  anchor?: boolean;
  alreadyHaveUse?: boolean;
  /** Parsed from the SQL that was blocked (Inspector). */
  fromQuery?: boolean;
};

const MAX = 8;

async function searchOnce(orgId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const nameRows = await searchEstateTables(orgId, term);
  const meaningRows = await searchTablesByMeaning(orgId, term, 15).catch(() => []);
  let merged = mergeTableSearchHits(nameRows, meaningRows);
  if (meaningRows.length > 0) merged = await rerankTableSearchHits(term, merged);
  return merged;
}

export async function suggestRequestTargets(
  orgId: string,
  opts: {
    purpose: string;
    context?: string;
    anchorPath?: string;
    requesterId?: string;
    /** Tables from the blocked query — default list before hybrid search. */
    queryPaths?: string[];
    /** When false and queryPaths is set, skip hybrid discovery (Inspector prefill). */
    expandDiscovery?: boolean;
  },
): Promise<{ tables: SuggestedTable[]; schemaHint: string | null; fromQuery: boolean }> {
  const byPath = new Map<string, SuggestedTable>();
  const anchor = opts.anchorPath?.toLowerCase();
  const expandDiscovery = opts.expandDiscovery ?? !(opts.queryPaths?.length);
  const fromInspector = (opts.queryPaths?.length ?? 0) > 0 && !expandDiscovery;

  if (opts.queryPaths?.length) {
    for (const raw of opts.queryPaths) {
      const p = raw.toLowerCase().trim();
      if (p.split('.').length !== 3) continue;
      byPath.set(p, {
        path: p,
        kind: 'table',
        label: friendlyDataLabel(p),
        description: null,
        match: 'name',
        anchor: !!anchor && p === anchor,
        fromQuery: true,
      });
    }
  }

  if (fromInspector) {
    // Fall through to access check + return — no semantic table flood.
  } else {
  const queries = [
    ...purposePhrases(opts.purpose),
    ...(opts.context ? [opts.context.slice(0, 400)] : []),
  ];

  for (const q of queries) {
    const hits = await searchOnce(orgId, q);
    for (const h of hits) {
      if (h.path.split('.').length !== 3) continue;
      const prev = byPath.get(h.path);
      if (!prev || (h.score ?? 0) > (prev.match === 'meaning' ? 0 : 0.5)) {
        byPath.set(h.path, {
          path: h.path,
          kind: h.kind,
          label: friendlyDataLabel(h.path),
          description: h.description ?? null,
          match: h.match,
        });
      }
    }
  }
  }

  if (opts.anchorPath) {
    const p = opts.anchorPath.toLowerCase();
    const leaf = byPath.get(p) ?? {
      path: p,
      kind: 'table',
      label: friendlyDataLabel(p),
      match: 'name' as const,
      anchor: true,
    };
    leaf.anchor = true;
    byPath.set(p, leaf);
  }

  let have = new Set<string>();
  if (opts.requesterId) {
    const summary = await personAccessSummary(orgId, opts.requesterId);
    have = new Set(summary.rules.filter((r) => r.access !== 'block').map((r) => r.path.toLowerCase()));
  }

  const tables = [...byPath.values()]
    .map((t) => ({ ...t, alreadyHaveUse: have.has(t.path) }))
    .sort((a, b) => Number(b.anchor) - Number(a.anchor) || Number(a.alreadyHaveUse) - Number(b.alreadyHaveUse))
    .slice(0, MAX);

  const schemaCounts = new Map<string, number>();
  for (const t of tables) {
    const parts = t.path.split('.');
    if (parts.length >= 2) schemaCounts.set(`${parts[0]}.${parts[1]}`, (schemaCounts.get(`${parts[0]}.${parts[1]}`) ?? 0) + 1);
  }
  let schemaHint: string | null = null;
  for (const [schema, n] of schemaCounts) {
    if (n >= 3) {
      schemaHint = `You selected ${n} tables in ${schema}. Approvers may prefer one request at schema level (covers all tables inside).`;
      break;
    }
  }

  return { tables, schemaHint, fromQuery: fromInspector || tables.some((t) => t.fromQuery) };
}
