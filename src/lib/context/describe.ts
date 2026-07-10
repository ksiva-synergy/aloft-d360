// INVARIANT: no warehouse access in this file.
// All reads come exclusively from platform_context_* tables via Prisma.
// executeDatabricksSQL must never be called here, directly or transitively.
// enqueue() writes to platform_context_jobs only — no warehouse contact.

import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { enqueue } from '@/lib/context/queue';
import { embedQuery } from '@/lib/context/embed';
import { tokenizeQuery } from '@/lib/context/keywords';

// ── Input / output types ──────────────────────────────────────────────────────

export interface ListInput {
  orgId: string;
  /** Display name or Databricks connection name, e.g. "synergy_dwh" */
  connection: string;
  page?: number;
  pageSize?: number;
}

export interface ObjectListItem {
  path: string;
  kind: string;
  row_count_est: number | null;
  summary: string;
}

export interface ListResult {
  objects: ObjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  connection_resolved: string | null;
  /** Set when catalog is empty but connection name was resolved */
  guidance?: string;
  available_connections?: string[];
}

export interface DescribeInput {
  orgId: string;
  connection: string;
  path: string;
  detail?: 'compact' | 'full';
}

export interface ColumnCard {
  name: string;
  type: string;
  nullable: boolean;
  comment: string | null;
  null_rate?: number | null;
  top_k?: { value: unknown; count: number }[];
  // Semantic fields — present after T2 enrichment; status is at DescribeResult.semantic.status
  role?: string;
  description?: string;
  pii_flag?: boolean;
}

// ── Profile action types ──────────────────────────────────────────────────────

export interface ProfileInput {
  orgId: string;
  connection: string;
  path: string;
}

export interface ProfileColumnStats {
  name: string;
  null_rate: number | null;
  distinct_est: number | null;
  min: unknown | null;
  max: unknown | null;
  top_k: { value: unknown; count: number }[] | null;
}

export interface ProfileResult {
  path: string;
  version: number | null;
  captured_at: string | null;
  columns: ProfileColumnStats[];
  drift: Record<string, unknown> | null;
  freshness: FreshnessBlock;
}

export interface FreshnessBlock {
  structural_as_of: string | null;
  profile_as_of: string | null;
  source_altered_at: string | null;
  stale: boolean;
  guidance: string;
}

export interface SemanticCard {
  summary: string;
  grain: string;
  key_columns: string[];
  usage_patterns: { intent: string; sql_sketch: string }[];
  caveats: string[];
  pii_columns: string[];
  /** Trust lifecycle status — 'assumed' until certified (DESIGN.md §6.3) */
  status: string;
  confidence: number;
  /** Objects in the same entity group, from entity_tags (CH7) */
  related_objects?: Array<{ path: string; label: string }>;
}

export interface DescribeResult {
  path: string;
  kind: string;
  native_comment: string | null;
  /** Object-level semantic card — present after T2 enrichment */
  semantic?: SemanticCard;
  columns: ColumnCard[];
  /** Present only when compact mode truncated columns */
  columns_total?: number;
  freshness: FreshnessBlock;
}

// ── Connection resolution ─────────────────────────────────────────────────────

const GENERIC_CONNECTION_ALIASES = new Set([
  'databricks', 'warehouse', 'sql', 'db', 'dwh', 'sql warehouse',
]);

/** Map generic labels like "Databricks" to a registered connection name. */
export async function resolveConnectionName(connection: string): Promise<string> {
  const trimmed = connection.trim();
  if (!trimmed) return trimmed;

  if (GENERIC_CONNECTION_ALIASES.has(trimmed.toLowerCase())) {
    const preferred = await prisma.platformDatabricksConnection.findFirst({
      where: {
        status: 'active',
        NOT: { name: 'smoke-test-connection' },
      },
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    if (preferred) return preferred.name;
  }

  const byName = await prisma.platformDatabricksConnection.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { name: true },
  });
  return byName?.name ?? trimmed;
}

interface SourceMatch {
  sourceIds: string[];
  displayName: string | null;
}

async function findContextSources(
  where: Prisma.PlatformContextSourceWhereInput,
): Promise<{ id: string; display_name: string | null }[]> {
  try {
    return await prisma.platformContextSource.findMany({
      where,
      select: { id: true, display_name: true },
    });
  } catch {
    // Context harness tables may not be migrated on this database yet.
    return [];
  }
}

async function resolveSourceIds(orgId: string, connection: string): Promise<SourceMatch> {
  const resolvedName = await resolveConnectionName(connection);

  // Try 1: display_name contains the connection string (case-insensitive)
  const byName = await findContextSources({
    org_id: orgId,
    status: 'active',
    display_name: { contains: resolvedName, mode: 'insensitive' },
  });
  if (byName.length > 0) {
    return { sourceIds: byName.map((s) => s.id), displayName: byName[0].display_name };
  }

  // Try 2: match via PlatformDatabricksConnection.name → connection_ref
  const conn = await prisma.platformDatabricksConnection.findFirst({
    where: { name: { equals: resolvedName, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (conn) {
    const byCR = await findContextSources({
      org_id: orgId,
      status: 'active',
      connection_ref: conn.id,
    });
    if (byCR.length > 0) {
      return { sourceIds: byCR.map((s) => s.id), displayName: conn.name };
    }
    // Connection exists but no harvested catalog yet — still report resolved name.
    return { sourceIds: [], displayName: conn.name };
  }

  return { sourceIds: [], displayName: null };
}

// ── Freshness builder ─────────────────────────────────────────────────────────

export function buildFreshness(obj: {
  last_t0_at: Date | null;
  last_t1_at: Date | null;
  source_altered_at: Date | null;
}): FreshnessBlock {
  const structural_as_of = obj.last_t0_at ? obj.last_t0_at.toISOString() : null;
  const profile_as_of = obj.last_t1_at ? obj.last_t1_at.toISOString() : null;
  const source_altered_at = obj.source_altered_at ? obj.source_altered_at.toISOString() : null;

  // stale iff source was altered after last structural harvest (spec §7.2)
  const stale =
    obj.source_altered_at !== null &&
    obj.last_t0_at !== null &&
    obj.source_altered_at > obj.last_t0_at;

  let guidance: string;
  if (obj.last_t0_at === null) {
    guidance = 'No structural harvest completed yet. Run a T0 harvest before querying.';
  } else if (stale) {
    guidance =
      'Structure may have changed since last harvest. Verify with db_query DESCRIBE TABLE if column-level precision matters.';
  } else if (profile_as_of === null) {
    guidance =
      'Structural data is current. Column-level statistics not yet available — run a T1 profile harvest to populate column stats.';
  } else {
    guidance = 'Structural and profile data are current.';
  }

  return { structural_as_of, profile_as_of, source_altered_at, stale, guidance };
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function listObjects(input: ListInput): Promise<ListResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50));
  const skip = (page - 1) * pageSize;

  const { sourceIds, displayName } = await resolveSourceIds(input.orgId, input.connection);
  if (sourceIds.length === 0) {
    const activeConnections = await prisma.platformDatabricksConnection.findMany({
      where: { status: 'active' },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    const names = activeConnections.map((c) => c.name);
    const guidance = displayName
      ? 'Schema catalog is empty for this connection (harvest not run or context tables not migrated). ' +
        'Use execute_tool with the attached db_query tool for live warehouse SQL — e.g. SHOW CATALOGS or ' +
        'SELECT * FROM system.information_schema.tables LIMIT 5. Do NOT use SHOW TABLES LIMIT N (invalid on Databricks).'
      : `Connection '${input.connection}' not resolved. Use a registered connection name: ${names.join(', ') || '(none active)'}.`;
    return {
      objects: [],
      total: 0,
      page,
      pageSize,
      connection_resolved: displayName,
      guidance,
      available_connections: names,
    };
  }

  const [rows, total] = await Promise.all([
    prisma.platformContextObject.findMany({
      where: { source_id: { in: sourceIds }, lifecycle: 'active' },
      select: {
        id: true,
        full_path: true,
        object_kind: true,
        row_count_est: true,
        native_comment: true,
      },
      orderBy: { full_path: 'asc' },
      skip,
      take: pageSize,
    }),
    prisma.platformContextObject.count({
      where: { source_id: { in: sourceIds }, lifecycle: 'active' },
    }),
  ]);

  // Batch-fetch the latest semantic card summary per object (one extra query, never N+1)
  const objectIds = rows.map((r) => r.id);
  const cardRows = await prisma.platformContextSemantic.findMany({
    where: { subject_kind: 'object', subject_id: { in: objectIds } },
    orderBy: { version: 'desc' },
    select: { subject_id: true, card: true },
  });
  const summaryByObjectId = new Map<string, string>();
  for (const c of cardRows) {
    if (!summaryByObjectId.has(c.subject_id)) {
      const summary = (c.card as Record<string, unknown>).summary;
      if (typeof summary === 'string') summaryByObjectId.set(c.subject_id, summary);
    }
  }

  const objects: ObjectListItem[] = rows.map((r) => ({
    path: r.full_path,
    kind: r.object_kind,
    row_count_est: r.row_count_est !== null ? Number(r.row_count_est) : null,
    summary:
      summaryByObjectId.get(r.id)?.slice(0, 150) ??
      r.native_comment?.slice(0, 100) ??
      'No summary available',
  }));

  return { objects, total, page, pageSize, connection_resolved: displayName };
}

// ── describe ──────────────────────────────────────────────────────────────────

// In compact mode, columns are capped at this count to stay within the
// ~200–400 token budget per DESIGN.md §7.1.
const COMPACT_COLUMN_LIMIT = 60;

export async function describeObject(input: DescribeInput): Promise<DescribeResult | null> {
  const { sourceIds } = await resolveSourceIds(input.orgId, input.connection);

  const obj = await prisma.platformContextObject.findFirst({
    where: {
      org_id: input.orgId,
      full_path: input.path,
      lifecycle: 'active',
      ...(sourceIds.length > 0 ? { source_id: { in: sourceIds } } : {}),
    },
    select: {
      id: true,
      source_id: true,
      full_path: true,
      object_kind: true,
      native_comment: true,
      source_altered_at: true,
      last_t0_at: true,
      last_t1_at: true,
      last_t2_at: true,
      entity_tags: true,
      columns: {
        where: { lifecycle: 'active' },
        orderBy: { ordinal: 'asc' },
        select: { name: true, data_type: true, is_nullable: true, native_comment: true, profile: true, semantic: true },
      },
    },
  });

  if (!obj) return null;

  const isCompact = (input.detail ?? 'compact') === 'compact';
  const allCols = obj.columns;
  const truncated = isCompact && allCols.length > COMPACT_COLUMN_LIMIT;
  const cols = truncated ? allCols.slice(0, COMPACT_COLUMN_LIMIT) : allCols;

  const columns: ColumnCard[] = cols.map((c) => {
    const card: ColumnCard = {
      name: c.name,
      type: c.data_type ?? 'unknown',
      nullable: c.is_nullable ?? true,
      comment: c.native_comment,
    };
    const sem = (c.semantic ?? {}) as Record<string, unknown>;
    // Semantic fields from T2 enrichment
    if (typeof sem.role === 'string') card.role = sem.role;
    if (typeof sem.description === 'string') card.description = sem.description;
    if (typeof sem.pii_flag === 'boolean') card.pii_flag = sem.pii_flag;
    if (c.profile) {
      type TopKEntry = { value: unknown; count: number };
      const p = c.profile as Record<string, unknown>;
      if (typeof p.null_rate === 'number') card.null_rate = p.null_rate;
      // Suppress top_k for PII-flagged columns (DESIGN.md §5.3, CH5 D-04)
      if (sem.pii_flag !== true && Array.isArray(p.top_k) && (p.top_k as TopKEntry[]).length > 0) {
        card.top_k = (p.top_k as TopKEntry[]).slice(0, 5);
      }
    }
    return card;
  });

  // Fetch the latest semantic card for this object
  const latestSemantic = await prisma.platformContextSemantic.findFirst({
    where: { subject_kind: 'object', subject_id: obj.id },
    orderBy: { version: 'desc' },
    select: { card: true, status: true, confidence: true },
  });

  let semanticCard: SemanticCard | undefined;
  if (latestSemantic) {
    const c = latestSemantic.card as Record<string, unknown>;
    semanticCard = {
      summary: typeof c.summary === 'string' ? c.summary : '',
      grain: typeof c.grain === 'string' ? c.grain : '',
      key_columns: Array.isArray(c.key_columns) ? (c.key_columns as string[]) : [],
      usage_patterns: Array.isArray(c.usage_patterns)
        ? (c.usage_patterns as { intent: string; sql_sketch: string }[])
        : [],
      caveats: Array.isArray(c.caveats) ? (c.caveats as string[]) : [],
      pii_columns: Array.isArray(c.pii_columns) ? (c.pii_columns as string[]) : [],
      status: latestSemantic.status,
      confidence: latestSemantic.confidence ?? 0,
    };

    // Populate related_objects from entity_tags (CH7)
    if (obj.entity_tags) {
      const tags = obj.entity_tags as { groups?: Array<{ label: string; member_paths: string[] }> };
      const related: Array<{ path: string; label: string }> = [];
      for (const grp of tags.groups ?? []) {
        for (const memberPath of grp.member_paths) {
          if (memberPath !== obj.full_path) {
            related.push({ path: memberPath, label: grp.label });
          }
        }
      }
      if (related.length > 0) semanticCard.related_objects = related;
    }
  }

  const freshness = buildFreshness({
    last_t0_at: obj.last_t0_at,
    last_t1_at: obj.last_t1_at,
    source_altered_at: obj.source_altered_at,
  });

  // Self-heal: enqueue t0_structural if structurally stale (CH4 pattern)
  if (freshness.stale) {
    maybeEnqueueStaleHarvest(obj.source_id, input.orgId).catch(() => undefined);
  }
  // Self-heal: enqueue t2_semantic if semantic card is absent or older than latest T1 (D-07)
  if (obj.last_t1_at && (!obj.last_t2_at || obj.last_t2_at < obj.last_t1_at)) {
    maybeEnqueueT2Enrich(obj.source_id, input.orgId).catch(() => undefined);
  }

  const result: DescribeResult = {
    path: obj.full_path,
    kind: obj.object_kind,
    native_comment: obj.native_comment,
    ...(semanticCard ? { semantic: semanticCard } : {}),
    columns,
    freshness,
  };

  if (truncated) {
    result.columns_total = allCols.length;
  }

  return result;
}

async function maybeEnqueueStaleHarvest(sourceId: string, orgId: string): Promise<void> {
  const active = await prisma.platformContextJob.findFirst({
    where: { source_id: sourceId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  });
  if (!active) {
    await enqueue('t0_structural', sourceId, null, 'on_demand', orgId);
  }
}

// Debounced by job_kind so a running t2 job doesn't block concurrent t0/t1 work (CH5 D-07)
async function maybeEnqueueT2Enrich(sourceId: string, orgId: string): Promise<void> {
  const active = await prisma.platformContextJob.findFirst({
    where: { source_id: sourceId, job_kind: 't2_semantic', status: { in: ['queued', 'running'] } },
    select: { id: true },
  });
  if (!active) {
    await enqueue('t2_semantic', sourceId, null, 'on_demand', orgId);
  }
}

// ── profile ───────────────────────────────────────────────────────────────────

export async function profileObject(input: ProfileInput): Promise<ProfileResult | null> {
  const { sourceIds } = await resolveSourceIds(input.orgId, input.connection);

  const obj = await prisma.platformContextObject.findFirst({
    where: {
      org_id: input.orgId,
      full_path: input.path,
      lifecycle: 'active',
      ...(sourceIds.length > 0 ? { source_id: { in: sourceIds } } : {}),
    },
    select: {
      id: true,
      full_path: true,
      last_t0_at: true,
      last_t1_at: true,
      source_altered_at: true,
      columns: {
        where: { lifecycle: 'active' },
        orderBy: { ordinal: 'asc' },
        select: { name: true, profile: true, semantic: true },
      },
    },
  });

  if (!obj) return null;

  const latestProfile = await prisma.platformContextProfile.findFirst({
    where: { object_id: obj.id },
    orderBy: { version: 'desc' },
    select: { version: true, captured_at: true, drift: true },
  });

  type TopKEntry = { value: unknown; count: number };

  const columns: ProfileColumnStats[] = obj.columns.map((c) => {
    const p = (c.profile ?? {}) as Record<string, unknown>;
    const sem = (c.semantic ?? {}) as Record<string, unknown>;
    const isPii = sem.pii_flag === true;
    return {
      name: c.name,
      null_rate: typeof p.null_rate === 'number' ? p.null_rate : null,
      distinct_est: typeof p.distinct_est === 'number' ? p.distinct_est : null,
      min: p.min !== undefined ? p.min : null,
      max: p.max !== undefined ? p.max : null,
      // Suppress top_k for PII-flagged columns (CH5 D-04)
      top_k: (!isPii && Array.isArray(p.top_k)) ? (p.top_k as TopKEntry[]) : null,
    };
  });

  return {
    path: obj.full_path,
    version: latestProfile?.version ?? null,
    captured_at: latestProfile?.captured_at.toISOString() ?? null,
    columns,
    drift: (latestProfile?.drift as Record<string, unknown> | null) ?? null,
    freshness: buildFreshness({
      last_t0_at: obj.last_t0_at,
      last_t1_at: obj.last_t1_at,
      source_altered_at: obj.source_altered_at,
    }),
  };
}

// ── keyword routing ───────────────────────────────────────────────────────────

export interface RoutePromptResult {
  /** Pre-matched object IDs → keyword overlap count */
  scores: Map<string, number>;
  /** True when confidence is high enough to skip Bedrock embed */
  routed: boolean;
  /** The tokens extracted from the query */
  tokens: string[];
}

/**
 * Fast keyword pre-filter for searchObjects().
 *
 * Tokenizes the user query and runs a sub-5ms GIN array-overlap query against
 * `platform_context_objects.domain_keywords`. Returns a scored map of object
 * IDs when confident enough to skip the Bedrock embedding call entirely.
 *
 * Routing fires when:
 *  - At least one object has an overlap score >= MIN_ROUTE_SCORE (≥2 shared tokens), OR
 *  - A single object has an exact-entity match (full query token set ⊆ domain_keywords)
 *
 * Falls back gracefully: if tokens.length === 0 or no rows match, routed=false.
 */
const MIN_ROUTE_SCORE = 2; // minimum overlapping keywords to trust routing

type KeywordRow = { id: string; domain_keywords: string[] };

export async function routePrompt(input: {
  orgId: string;
  query: string;
  k?: number;
}): Promise<RoutePromptResult> {
  const tokens = tokenizeQuery(input.query);
  const empty: RoutePromptResult = { scores: new Map(), routed: false, tokens };

  if (tokens.length === 0) return empty;

  // GIN overlap query — only fetches objects whose domain_keywords intersect the token array.
  // Uses Prisma raw to leverage the && operator and the GIN index.
  const rows = await prisma.$queryRaw<KeywordRow[]>`
    SELECT id::text AS id, domain_keywords
    FROM platform_context_objects
    WHERE org_id        = ${input.orgId}
      AND lifecycle     = 'active'
      AND domain_keywords && ${tokens}::text[]
    LIMIT ${Math.min((input.k ?? 5) * 4, 80)}
  `;

  if (rows.length === 0) return empty;

  // Score each row by the number of tokens that appear in its domain_keywords.
  const tokenSet = new Set(tokens);
  const scored = new Map<string, number>();
  for (const row of rows) {
    const overlap = row.domain_keywords.filter((kw) => tokenSet.has(kw)).length;
    scored.set(row.id, overlap);
  }

  // Routing fires when the best match has >= MIN_ROUTE_SCORE overlapping tokens.
  const bestScore = Math.max(...scored.values());
  if (bestScore < MIN_ROUTE_SCORE) return { scores: scored, routed: false, tokens };

  return { scores: scored, routed: true, tokens };
}

// ── search ────────────────────────────────────────────────────────────────────

export interface SearchInput {
  orgId: string;
  query: string;
  k?: number; // default 5, max 20
}

export interface SearchResultItem {
  path: string;
  kind: string;
  row_count_est: number | null;
  /** One-line reason, ~150-char budget per DESIGN.md §7.1 */
  reason: string;
  /** Blended score 0–1 (semantic × 0.7 + name-match bonus × 0.3) */
  score: number;
  match_type: 'semantic' | 'name' | 'blended';
}

export interface SearchResult {
  query: string;
  results: SearchResultItem[];
  embedding_available: boolean;
}

type EmbedRow = { subject_id: string; similarity: number };

/**
 * Semantic search over catalog objects for an org.
 *
 * Routing order (stops at the first layer that produces confident results):
 *  1. Keyword routing — GIN array overlap on domain_keywords (<5ms, no Bedrock).
 *     Fires when ≥2 query tokens appear in a stored keyword set.
 *  2. Bedrock embedding — pgvector cosine similarity via Titan v2 (~300ms).
 *     Used when keyword routing is insufficient or returns zero matches.
 *  3. ILIKE name match — always run as an additive blend.
 *
 * Always org-scoped — ingest-org = search-org invariant.
 */
export async function searchObjects(input: SearchInput): Promise<SearchResult> {
  const k = Math.min(Math.max(input.k ?? 5, 1), 20);
  const candidateLimit = k * 3;

  // ── 0. Keyword routing (fast path, zero Bedrock) ──────────────────────────────

  const route = await routePrompt({ orgId: input.orgId, query: input.query, k });

  // ── 1. Semantic candidates via pgvector (skipped when keyword routing succeeds) ─

  const semanticScores = new Map<string, number>(); // objectId → similarity 0–1
  let embeddingAvailable = false;

  if (!route.routed) {
    const vec = await embedQuery(input.query);
    embeddingAvailable = vec !== null;

    if (vec !== null) {
      const vecLiteral = `[${vec.join(',')}]`;
      const embedRows = await prisma.$queryRaw<EmbedRow[]>`
        SELECT
          e.subject_id::text AS subject_id,
          (1 - (e.embedding <=> ${vecLiteral}::text::vector))::float AS similarity
        FROM platform_context_embeddings e
        WHERE e.org_id    = ${input.orgId}
          AND e.subject_kind = 'object'
          AND e.embedding IS NOT NULL
        ORDER BY e.embedding <=> ${vecLiteral}::text::vector ASC
        LIMIT ${candidateLimit}
      `;
      for (const r of embedRows) {
        // Clamp: cosine similarity for unit vectors ∈ [-1, 1]; keep [0, 1]
        semanticScores.set(r.subject_id, Math.max(0, r.similarity));
      }
    }
  } else {
    // Keyword route succeeded — convert overlap scores to 0–1 range.
    // Max possible overlap = number of query tokens; normalise to [0, 0.9]
    // to leave headroom for the name-match blend below.
    const maxTokens = Math.max(route.tokens.length, 1);
    for (const [id, overlap] of route.scores) {
      semanticScores.set(id, Math.min((overlap / maxTokens) * 0.9, 0.9));
    }
    embeddingAvailable = true; // treat as available for result metadata
  }

  // ── 2. Name-match candidates via ILIKE ────────────────────────────────────────

  const nameRows = await prisma.platformContextObject.findMany({
    where: {
      org_id: input.orgId,
      lifecycle: 'active',
      OR: [
        { full_path: { contains: input.query, mode: 'insensitive' } },
        { object_name: { contains: input.query, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: candidateLimit,
  });
  const nameMatchIds = new Set(nameRows.map((r) => r.id));

  // ── 3. Merge candidate IDs and compute blended scores ────────────────────────

  const allIds = new Set([...semanticScores.keys(), ...nameMatchIds]);
  if (allIds.size === 0) {
    return { query: input.query, results: [], embedding_available: embeddingAvailable };
  }

  type ScoredId = { id: string; score: number; match_type: SearchResultItem['match_type'] };
  const scored: ScoredId[] = [];

  for (const id of allIds) {
    const semScore = semanticScores.get(id) ?? 0;
    const nameBonus = nameMatchIds.has(id) ? 0.3 : 0;
    const inBoth = semScore > 0 && nameMatchIds.has(id);
    scored.push({
      id,
      score: semScore * 0.7 + nameBonus,
      match_type: inBoth ? 'blended' : semScore > 0 ? 'semantic' : 'name',
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // ── 4. Entity group boost (+0.05 for objects sharing a group with a top-K hit) ─

  const ENTITY_GROUP_BOOST = 0.05;
  const extPool = scored.slice(0, Math.min(scored.length, k * 3));
  const extPoolIds = extPool.map((s) => s.id);

  const extObjects = await prisma.platformContextObject.findMany({
    where: { id: { in: extPoolIds }, org_id: input.orgId },
    select: { id: true, full_path: true, object_kind: true, row_count_est: true, native_comment: true, entity_tags: true },
  });
  const extObjMap = new Map(extObjects.map((o) => [o.id, o]));

  // Collect group member paths from the initial top-K reference set
  const groupLabelByPath = new Map<string, string>(); // member_path → group label
  for (const { id } of extPool.slice(0, k)) {
    const obj = extObjMap.get(id);
    const tags = obj?.entity_tags as { groups?: Array<{ label: string; member_paths: string[] }> } | null;
    for (const grp of tags?.groups ?? []) {
      for (const mp of grp.member_paths) {
        groupLabelByPath.set(mp, grp.label);
      }
    }
  }

  // Apply boost to items outside the initial top-K that are in a top-K group
  for (const s of extPool.slice(k)) {
    const obj = extObjMap.get(s.id);
    if (obj && groupLabelByPath.has(obj.full_path)) {
      s.score += ENTITY_GROUP_BOOST;
    }
  }

  // Re-sort and take final top-K
  extPool.sort((a, b) => b.score - a.score);
  const topIds = extPool.slice(0, k).map((s) => s.id);

  // Batch load latest semantic card summaries for final top-K
  const semantics = await prisma.platformContextSemantic.findMany({
    where: { subject_kind: 'object', subject_id: { in: topIds } },
    orderBy: { version: 'desc' },
    select: { subject_id: true, card: true },
  });
  const summaryMap = new Map<string, string>();
  for (const s of semantics) {
    if (!summaryMap.has(s.subject_id)) {
      const c = s.card as Record<string, unknown>;
      if (typeof c.summary === 'string') summaryMap.set(s.subject_id, c.summary);
    }
  }

  // ── 5. Build result list in score order ──────────────────────────────────────

  const results: SearchResultItem[] = [];
  for (const { id, score, match_type } of extPool.slice(0, k)) {
    const obj = extObjMap.get(id);
    if (!obj) continue;

    const rawSummary = summaryMap.get(id) ?? obj.native_comment ?? 'No summary available.';
    const groupLabel = groupLabelByPath.get(obj.full_path);
    const reason = groupLabel
      ? `${rawSummary.slice(0, 110)} [same entity group: ${groupLabel}]`
      : rawSummary.slice(0, 150);

    results.push({
      path: obj.full_path,
      kind: obj.object_kind,
      row_count_est: obj.row_count_est !== null ? Number(obj.row_count_est) : null,
      reason,
      score: Math.round(score * 1000) / 1000,
      match_type,
    });
  }

  return { query: input.query, results, embedding_available: embeddingAvailable };
}

// ── relations ─────────────────────────────────────────────────────────────────

export interface RelationsInput {
  orgId: string;
  connection: string;
  path: string;
}

export interface RelationItem {
  kind: 'fk_candidate' | 'column_mapping' | 'entity_group_member';
  /** The related path — target table or full column path (catalog.schema.table.col) */
  path: string;
  /** The local column name for fk_candidate and column_mapping items */
  column?: string;
  mapping_kind?: string | null;
  status: string;
  confidence?: number | null;
  rationale?: string;
}

export interface RelationsResult {
  path: string;
  items: RelationItem[];
}

/**
 * Returns FK candidates from the semantic card, proposed column mappings
 * touching this object, and entity group membership. Every item carries
 * status and confidence so callers can surface trust level.
 */
export async function relationsObject(input: RelationsInput): Promise<RelationsResult | null> {
  const obj = await prisma.platformContextObject.findFirst({
    where: { org_id: input.orgId, full_path: input.path, lifecycle: 'active' },
    select: {
      id: true,
      full_path: true,
      entity_tags: true,
      columns: {
        where: { lifecycle: 'active' },
        select: { id: true, name: true },
      },
    },
  });
  if (!obj) return null;

  const items: RelationItem[] = [];

  // 1. FK candidates from the latest semantic card
  const semantic = await prisma.platformContextSemantic.findFirst({
    where: { subject_kind: 'object', subject_id: obj.id },
    orderBy: { version: 'desc' },
    select: { card: true, status: true },
  });
  if (semantic) {
    const c = semantic.card as Record<string, unknown>;
    const fkCandidates = Array.isArray(c.fk_candidates)
      ? (c.fk_candidates as { column: string; likely_target: string; confidence: number }[])
      : [];
    for (const fk of fkCandidates) {
      items.push({
        kind: 'fk_candidate',
        path: fk.likely_target,
        column: fk.column,
        status: semantic.status,
        confidence: fk.confidence,
      });
    }
  }

  // 2. Proposed column mappings where one side is in this object
  const colIds = obj.columns.map((c) => c.id);
  if (colIds.length > 0) {
    const mappings = await prisma.platformContextMapping.findMany({
      where: {
        OR: [
          { left_column_id: { in: colIds } },
          { right_column_id: { in: colIds } },
        ],
        status: 'proposed',
      },
      select: {
        mapping_kind: true,
        confidence: true,
        llm_verdict: true,
        left_column: {
          select: { name: true, object: { select: { full_path: true } } },
        },
        right_column: {
          select: { name: true, object: { select: { full_path: true } } },
        },
      },
    });

    for (const m of mappings) {
      const leftObjPath = m.left_column.object.full_path;
      const rightObjPath = m.right_column.object.full_path;
      const isLeftSelf = leftObjPath === input.path;

      const localCol = isLeftSelf ? m.left_column.name : m.right_column.name;
      const otherColPath = isLeftSelf
        ? `${rightObjPath}.${m.right_column.name}`
        : `${leftObjPath}.${m.left_column.name}`;

      const verdict = m.llm_verdict as Record<string, unknown> | null;
      items.push({
        kind: 'column_mapping',
        path: otherColPath,
        column: localCol,
        mapping_kind: m.mapping_kind,
        status: 'proposed',
        confidence: m.confidence,
        rationale: typeof verdict?.rationale === 'string' ? verdict.rationale : undefined,
      });
    }
  }

  // 3. Entity group members from entity_tags
  if (obj.entity_tags) {
    const tags = obj.entity_tags as {
      groups?: Array<{ label: string; member_paths: string[]; via_mappings: number }>;
    };
    for (const grp of tags.groups ?? []) {
      for (const memberPath of grp.member_paths) {
        if (memberPath !== obj.full_path) {
          items.push({
            kind: 'entity_group_member',
            path: memberPath,
            status: 'proposed',
            rationale: `same entity group: ${grp.label} (${grp.via_mappings} mappings)`,
          });
        }
      }
    }
  }

  return { path: obj.full_path, items };
}

// ── usage ─────────────────────────────────────────────────────────────────────
// INVARIANT: zero calls to executeDatabricksSQL — Aurora reads only.
// All fields are served from platform_context_usage + platform_context_semantics.

export interface UsageFreshnessBlock {
  usage_as_of: string | null;
  window_days: number;
  stale: boolean;
  guidance: string;
}

export interface UsageObjectResult {
  full_path: string;
  last_t3_at: Date | null;
  window_start: Date | null;
  window_end: Date | null;
  access_stats: unknown;
  source_breakdown: unknown;
  key_columns: unknown;
  filter_patterns: unknown;
  co_objects: unknown;
  narratives_applied: boolean;
  /** LLM-generated usage narrative text, null if no narrative exists */
  usage_narrative: string | null;
  freshness: UsageFreshnessBlock;
}

const USAGE_STALE_DAYS = 8;

export async function usageObject(
  path: string,
  orgId: string,
): Promise<UsageObjectResult | null> {
  // Step 1: resolve path → context_object_id
  const obj = await prisma.platformContextObject.findFirst({
    where: { org_id: orgId, full_path: path },
    select: { id: true, full_path: true, last_t3_at: true },
  });
  if (!obj) return null;

  // Step 2: load the latest usage snapshot (highest version)
  const usage = await prisma.platformContextUsage.findFirst({
    where: { orgId, contextObjectId: obj.id },
    orderBy: { version: 'desc' },
    select: {
      windowStart: true,
      windowEnd: true,
      accessStats: true,
      sourceBreakdown: true,
      keyColumns: true,
      filterPatterns: true,
      coObjects: true,
    },
  });
  if (!usage) return null;

  // Step 3: check for an 'observed' usage narrative in platform_context_semantics
  const narrativeRow = await prisma.platformContextSemantic.findFirst({
    where: {
      org_id: orgId,
      subject_kind: 'object',
      subject_id: obj.id,
      status: 'observed',
    },
    select: { id: true, card: true },
  });

  // Step 4: compute freshness
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - USAGE_STALE_DAYS * 86_400_000);
  const stale = obj.last_t3_at === null || obj.last_t3_at < staleCutoff;

  let windowDays = 0;
  if (usage.windowStart && usage.windowEnd) {
    windowDays = Math.round(
      (usage.windowEnd.getTime() - usage.windowStart.getTime()) / 86_400_000,
    );
  }

  const freshness: UsageFreshnessBlock = {
    usage_as_of: obj.last_t3_at ? obj.last_t3_at.toISOString() : null,
    window_days: windowDays,
    stale,
    guidance: stale
      ? 'Usage data is stale — T3 harvest may not have run this week.'
      : 'Usage data is current.',
  };

  // Step 5: slice key_columns and filter_patterns to top 10
  const keyColumns = Array.isArray(usage.keyColumns)
    ? (usage.keyColumns as unknown[]).slice(0, 10)
    : usage.keyColumns;
  const filterPatterns = Array.isArray(usage.filterPatterns)
    ? (usage.filterPatterns as unknown[]).slice(0, 10)
    : usage.filterPatterns;
  const coObjects = Array.isArray(usage.coObjects)
    ? (usage.coObjects as unknown[]).slice(0, 10)
    : usage.coObjects;

  return {
    full_path: obj.full_path,
    last_t3_at: obj.last_t3_at,
    window_start: usage.windowStart,
    window_end: usage.windowEnd,
    access_stats: usage.accessStats,
    source_breakdown: usage.sourceBreakdown,
    key_columns: keyColumns,
    filter_patterns: filterPatterns,
    co_objects: coObjects,
    narratives_applied: narrativeRow !== null,
    usage_narrative: narrativeRow?.card
      ? (typeof (narrativeRow.card as Record<string, unknown>)['usage_patterns'] === 'string'
          ? (narrativeRow.card as Record<string, unknown>)['usage_patterns'] as string
          : null)
      : null,
    freshness,
  };
}
