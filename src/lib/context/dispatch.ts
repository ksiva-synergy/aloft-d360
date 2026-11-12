// Dispatch layer for the describe_schema tool.
// No warehouse access in this file or its callees (listObjects / describeObject are pure Prisma reads).
// getDefaultOrg provides org scoping; no session context is consulted.

import 'server-only';
import { getDefaultOrg } from '@/lib/platform/agents';
import prisma from '@/lib/db';
import { listObjects, describeObject, profileObject, searchObjects, relationsObject, usageObject } from './describe';
import type { AccessPrincipal } from '@/lib/access/types';
import { shouldEvaluateAccess } from '@/lib/access/config';
import { visibleObjectIds } from '@/lib/access/visibility';
import type { AccessLevel } from '@/lib/access/types';

/** Agent turns fire several describe_schema tools at once; keep them from filling the pool. */
let describeActive = 0;
const describeWaiters: Array<() => void> = [];
const DESCRIBE_SCHEMA_CONCURRENCY = 2;

function withDescribeSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      describeActive += 1;
      fn().then(resolve, reject).finally(() => {
        describeActive -= 1;
        describeWaiters.shift()?.();
      });
    };
    if (describeActive < DESCRIBE_SCHEMA_CONCURRENCY) start();
    else describeWaiters.push(start);
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function handleDescribeSchema(
  input: Record<string, unknown>,
  dataPrincipal?: AccessPrincipal | null,
): Promise<string> {
  return withDescribeSlot(async () => {
    const raw = await runDescribeSchema(input, dataPrincipal);
    // Protected column values never reach the AI for people without the protection (enforce mode).
    const { filterDescribeResult } = await import('@/lib/access/describe-filter');
    return filterDescribeResult(raw, dataPrincipal, (input.path as string | undefined) ?? null);
  });
}

function levelForDescribeAction(action: string): AccessLevel {
  if (action === 'profile' || action === 'usage') return 'query';
  return 'discover';
}

async function runDescribeSchema(
  input: Record<string, unknown>,
  dataPrincipal?: AccessPrincipal | null,
): Promise<string> {
  const action = (input.action as string | undefined) ?? '';
  const connection = (input.connection as string | undefined) ?? '';
  const path = input.path as string | undefined;
  const detail = (input.detail as 'compact' | 'full' | undefined) ?? 'compact';

  if (!connection) {
    return JSON.stringify({ error: "Missing required parameter 'connection'." });
  }

  if (shouldEvaluateAccess() && !dataPrincipal) {
    return JSON.stringify({ error: 'Data access principal is required for describe_schema.' });
  }

  let orgId: string;
  try {
    const org = await getDefaultOrg();
    orgId = org.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return JSON.stringify({ error: `Could not resolve org: ${msg}` });
  }

  const visibleIds =
    dataPrincipal != null && shouldEvaluateAccess()
      ? await visibleObjectIds(
          dataPrincipal,
          levelForDescribeAction(action),
          await prisma.platformContextObject.findMany({
            where: { org_id: orgId, lifecycle: 'active' },
            select: { id: true, full_path: true },
          }),
        )
      : null;
  const visibility = { visibleObjectIds: visibleIds };

  if (action === 'list') {
    const { resolveConnectionName } = await import('./describe');
    const resolvedConnection = await resolveConnectionName(connection);
    const result = await listObjects({ orgId, connection: resolvedConnection, ...visibility });
    return JSON.stringify(result);
  }

  if (action === 'describe') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'describe' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await describeObject({ orgId, connection, path, detail, ...visibility });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'profile') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'profile' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await profileObject({ orgId, connection, path, ...visibility });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'search') {
    const query = (input.query as string | undefined)?.trim();
    if (!query) {
      return JSON.stringify({
        error: "Action 'search' requires a 'query' parameter (free-text natural language query).",
      });
    }
    const k = typeof input.k === 'number' ? input.k : 5;
    const result = await searchObjects({ orgId, query, k, ...visibility });
    return JSON.stringify(result);
  }

  if (action === 'research') {
    const query = (input.query as string | undefined)?.trim();
    if (!query) {
      return JSON.stringify({
        error: "Action 'research' requires a 'query' parameter (free-text natural language query).",
      });
    }
    const k = typeof input.k === 'number' ? Math.min(Math.max(input.k, 1), 5) : 5;
    const search = await searchObjects({ orgId, query, k, ...visibility });
    // One candidate at a time. Parallel describe + relations across every hit
    // filled the Prisma pool before the next connection lookup could start.
    const candidates = await mapWithConcurrency(search.results, 1, async (candidate) => {
      const description = await describeObject({ orgId, connection, path: candidate.path, detail: 'compact', ...visibility });
      const relations = await relationsObject({ orgId, connection, path: candidate.path, ...visibility });

      return {
        ...candidate,
        inspected: description !== null,
        semantic_card: description?.semantic ?? null,
        native_comment: description?.native_comment ?? null,
        columns: description?.columns.slice(0, 20) ?? [],
        columns_total: description?.columns_total ?? description?.columns.length ?? null,
        relationships: relations?.items.slice(0, 15) ?? [],
        relationship_evidence_available: relations !== null && relations.items.length > 0,
      };
    });

    return JSON.stringify({
      query: search.query,
      retrieval: {
        method: 'pgvector semantic similarity blended with harvested keyword and exact-name evidence',
        embedding_available: search.embedding_available,
        vector_candidates_found: search.vector_candidates_found,
        vector_index: search.vector_index,
        note: !search.embedding_available
          ? 'Query embedding failed. These are lexical candidates only, not semantically validated matches.'
          : search.vector_index.comparable_embeddings === 0
            ? `The vector index has no active objects embedded with ${search.vector_index.query_model} (${search.vector_index.other_model_embeddings} use another model and are not comparable). Semantic search did not run; these are lexical candidates only. Tell the user the catalog needs re-embedding.`
            : search.vector_candidates_found === 0
              ? 'No vector-index candidates were found. Treat any returned candidates as lexical leads, not semantically validated matches.'
              : `Vector candidates were found from ${search.vector_index.comparable_embeddings} of ${search.vector_index.active_objects} active objects that are embedded; unembedded tables can only appear through name/keyword matches. Each candidate still requires mission-fit review using its harvested descriptions, columns, and relationships.`,
      },
      candidates,
    });
  }

  if (action === 'relations') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'relations' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await relationsObject({ orgId, connection, path, ...visibility });
    if (!result) {
      return JSON.stringify({
        error: `Object not found: '${path}'. Use action:'list' to see available objects for this connection.`,
      });
    }
    return JSON.stringify(result);
  }

  if (action === 'usage') {
    if (!path) {
      return JSON.stringify({
        error: "Action 'usage' requires a 'path' argument (catalog.schema.table).",
      });
    }
    const result = await usageObject(path, orgId, visibility);
    if (!result) {
      return JSON.stringify({
        error: `No usage data for: '${path}'. The object may not exist or T3 harvest has not run for it.`,
      });
    }
    return JSON.stringify({ action: 'usage', ...result });
  }

  return JSON.stringify({
    error: `Unknown action: '${action}'. Available actions: list, describe, profile, search, research, relations, usage.`,
    available_actions: ['list', 'describe', 'profile', 'search', 'research', 'relations', 'usage'],
  });
}
