import 'server-only';

import prisma from '@/lib/db';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { Prisma } from '@prisma/client';
import { DatabricksAdapter } from './databricks-adapter';
import type { RawHistoryRow } from './databricks-adapter';

// ── Bedrock client (private — mirrors enrich.ts, no export to avoid circular import) ───

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? 'us-east-1',
  });
}

// ── Usage narrative prompt ────────────────────────────────────────────────────

export const USAGE_NARRATIVE_PROMPT_V1 = `
You are a data catalog assistant. You will be given observed usage signals for a
database table derived from real query history and lineage analysis.

Your task: write a concise usage narrative for this table.

Return ONLY valid JSON with this exact shape:
{
  "usage_patterns": "<2-4 sentences describing how this table is actually used>",
  "key_columns":    ["<column>", "<column>", ...]
}

Rules:
- usage_patterns must describe actual observed behaviour (frequency, filters used,
  how it joins with other tables, scheduled vs ad-hoc split).
- key_columns must list only the most operationally important columns based on the
  signals. CRITICAL: every column you list MUST appear in the provided
  known_columns list. Do not invent or infer column names not in that list.
- Do not include any text outside the JSON object. No markdown, no preamble.
` as const;

// ── Zod schema for narrative LLM output ──────────────────────────────────────

const NarrativeResponseSchema = z.object({
  usage_patterns: z.string().min(10),
  key_columns: z.array(z.string()),
});

const NARRATIVE_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
export const NARRATIVE_PROMPT_VERSION = 'usage_narrative_v1';

// ── Public result type ────────────────────────────────────────────────────────

export interface T3UsageResult {
  objectsProcessed: number;
  snapshotsWritten: number;
  skipped: number;
  narrativesApplied: number;
  windowStart: string;
  windowEnd: string;
  /** Set when rowCap was hit — ISO timestamp to resume from on next job */
  nextCursor: string | null;
}

// ── Score weights ─────────────────────────────────────────────────────────────

export const T3_SCORE_WEIGHTS = {
  filtered:     3,
  joined:       2,
  lineage_out:  2,
  projected:    1,
} as const;

// ── Source classification ─────────────────────────────────────────────────────

type QuerySourceKind = 'job' | 'adhoc' | 'dashboard' | 'genie' | 'alert';

function classifyQuerySource(querySource: unknown): QuerySourceKind {
  let src: Record<string, unknown>;

  if (typeof querySource === 'string') {
    try {
      src = JSON.parse(querySource) as Record<string, unknown>;
    } catch {
      return 'adhoc';
    }
  } else if (querySource !== null && typeof querySource === 'object') {
    src = querySource as Record<string, unknown>;
  } else {
    return 'adhoc';
  }

  // Priority order per Databricks query_source struct docs
  if (src['job_info'] != null) return 'job';
  if (src['alert_id'] != null) return 'alert';
  if (src['genie_space_id'] != null) return 'genie';
  if (src['dashboard_id'] != null || src['legacy_dashboard_id'] != null) return 'dashboard';
  // notebook_id treated as adhoc
  return 'adhoc';
}

// ── maskPredicate ─────────────────────────────────────────────────────────────
// HARD INVARIANT (T3-4): output must NOT contain any digit, single-quote,
// or double-quote. The verify gate asserts this mechanically.

export function maskPredicate(raw: string): string {
  let s = raw;

  // Single-quoted string literals (including escaped quotes inside)
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, '?');

  // Double-quoted value literals (not SQL identifiers, but literal values)
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '?');

  // NULL / TRUE / FALSE keywords used as literal values
  s = s.replace(/\bNULL\b/gi, '?');
  s = s.replace(/\bTRUE\b/gi, '?');
  s = s.replace(/\bFALSE\b/gi, '?');

  // Numeric literals (integers and decimals) — after strings so e.g. '123' is
  // already masked and won't double-match
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, '?');

  return s;
}

// ── Weekly trend ──────────────────────────────────────────────────────────────

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon…
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeWeeklyTrend(
  rows: RawHistoryRow[],
  windowWeeks = 4,
): Array<{ week: string; n: number }> {
  const now = new Date();
  const weeks: Map<string, number> = new Map();

  // Pre-build the last N Mondays so sparse weeks show up as 0
  for (let i = windowWeeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const monday = getMondayOf(d);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, 0);
  }

  for (const row of rows) {
    if (!row.start_time) continue;
    const d = new Date(row.start_time);
    if (isNaN(d.getTime())) continue;
    const monday = getMondayOf(d);
    const key = monday.toISOString().slice(0, 10);
    if (weeks.has(key)) {
      weeks.set(key, (weeks.get(key) ?? 0) + 1);
    }
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, n]) => ({ week, n }));
}

// ── Key columns extraction ─────────────────────────────────────────────────────

interface KeyColumnEntry {
  column: string;
  projected_n: number;
  filtered_n: number;
  grouped_n: number;
  joined_n: number;
  lineage_out_n: number;
  score: number;
}

function extractKeyColumns(
  rows: RawHistoryRow[],
  knownColumns: Set<string>,
): KeyColumnEntry[] {
  const tallies = new Map<string, { projected_n: number; filtered_n: number; grouped_n: number; joined_n: number; lineage_out_n: number }>();

  for (const col of knownColumns) {
    tallies.set(col.toLowerCase(), { projected_n: 0, filtered_n: 0, grouped_n: 0, joined_n: 0, lineage_out_n: 0 });
  }

  for (const row of rows) {
    const sql = (row.statement_text ?? '').toUpperCase();

    // Split into zones: SELECT…FROM, WHERE/HAVING, GROUP BY, JOIN…ON
    // Use rough span detection — not a full parser, heuristic tallies only.
    const fromIdx = sql.indexOf(' FROM ');
    const selectZone = fromIdx > 0 ? sql.slice(0, fromIdx) : '';

    const whereMatch = sql.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/);
    const havingMatch = sql.match(/\bHAVING\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/);
    const groupByMatch = sql.match(/\bGROUP\s+BY\b([\s\S]*?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/);
    // ON spans following JOIN keywords
    const joinOnSegments: string[] = [];
    const joinOnRe = /\bJOIN\b[\s\S]*?\bON\b([\s\S]*?)(?:\bJOIN\b|\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|$)/g;
    let jm: RegExpExecArray | null;
    while ((jm = joinOnRe.exec(sql)) !== null) {
      joinOnSegments.push(jm[1]);
    }

    const filterZone = (whereMatch?.[1] ?? '') + ' ' + (havingMatch?.[1] ?? '');
    const groupByZone = groupByMatch?.[1] ?? '';
    const joinOnZone = joinOnSegments.join(' ');

    for (const [colLower, tally] of tallies.entries()) {
      // Use word-boundary matching (column names are typically identifiers)
      const re = new RegExp(`\\b${colLower}\\b`, 'i');
      if (re.test(selectZone)) tally.projected_n++;
      if (re.test(filterZone)) tally.filtered_n++;
      if (re.test(groupByZone)) tally.grouped_n++;
      if (re.test(joinOnZone)) tally.joined_n++;
    }
  }

  const result: KeyColumnEntry[] = [];
  for (const [col, t] of tallies.entries()) {
    const score = t.filtered_n * T3_SCORE_WEIGHTS.filtered
                + t.joined_n   * T3_SCORE_WEIGHTS.joined
                + t.lineage_out_n * T3_SCORE_WEIGHTS.lineage_out
                + t.projected_n * T3_SCORE_WEIGHTS.projected;
    result.push({ column: col, ...t, score });
  }

  return result
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

// ── Filter patterns extraction ────────────────────────────────────────────────

interface FilterPatternEntry {
  template: string;
  op: string;
  n: number;
}

const COMPARISON_OPS = ['<=', '>=', '!=', '<>', '<', '>', '='];

// RHS literal token: single-quoted string | double-quoted string | bare word
// Single/double-quoted forms capture the ENTIRE quoted token (including interior spaces)
// so that maskPredicate receives a complete literal rather than a truncated fragment.
const RHS_TOKEN = `(?:'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\\b(?:NULL|TRUE|FALSE)\\b|\\d+(?:\\.\\d+)?\\b)`;

const OP_PATTERN = new RegExp(
  `([a-z_][a-z0-9_]*)\\s*(${COMPARISON_OPS.map(o => o.replace(/[<>=!]/g, c => `\\${c}`)).join('|')})\\s*(${RHS_TOKEN})`,
  'gi',
);

function extractFilterPatterns(rows: RawHistoryRow[]): FilterPatternEntry[] {
  const tally = new Map<string, { op: string; n: number }>();

  for (const row of rows) {
    const sql = row.statement_text ?? '';

    // Extract WHERE and HAVING spans
    const whereMatch = sql.match(/\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/i);
    const havingMatch = sql.match(/\bHAVING\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i);
    const filterText = (whereMatch?.[1] ?? '') + ' ' + (havingMatch?.[1] ?? '');

    OP_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OP_PATTERN.exec(filterText)) !== null) {
      const colRaw = m[1];
      const op = m[2];
      const literal = m[3];

      const rawPredicate = `${colRaw} ${op} ${literal}`;
      const template = maskPredicate(rawPredicate);

      // Post-mask invariant: skip anything that still contains a quote or digit
      // (indicates a pattern the masker couldn't fully handle — don't store it).
      if (/\d/.test(template) || /['"]/.test(template)) continue;
      if (!template.includes('?')) continue;

      const key = template.toLowerCase();
      const existing = tally.get(key);
      if (existing) {
        existing.n++;
      } else {
        tally.set(key, { op, n: 1 });
      }
    }
  }

  return [...tally.entries()]
    .map(([template, { op, n }]) => ({ template, op, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 15);
}

// ── Co-object extraction ──────────────────────────────────────────────────────

interface CoObjectEntry {
  full_path: string;
  kind: 'cooccurrence' | 'lineage' | 'both';
  n: number;
}

const THREE_PART_ID_RE = /\b([a-z0-9_]+)\.([a-z0-9_]+)\.([a-z0-9_]+)\b/gi;

function extractCoObjects(rows: RawHistoryRow[], selfFullPath: string): CoObjectEntry[] {
  const tally = new Map<string, number>();
  const selfLower = selfFullPath.toLowerCase();

  for (const row of rows) {
    const sql = row.statement_text ?? '';
    THREE_PART_ID_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const seenInRow = new Set<string>();
    while ((m = THREE_PART_ID_RE.exec(sql)) !== null) {
      const fp = `${m[1]}.${m[2]}.${m[3]}`.toLowerCase();
      if (fp === selfLower) continue;
      if (seenInRow.has(fp)) continue;
      seenInRow.add(fp);
      tally.set(fp, (tally.get(fp) ?? 0) + 1);
    }
  }

  return [...tally.entries()]
    .map(([full_path, n]) => ({ full_path, kind: 'cooccurrence' as const, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);
}

// ── applyUsageNarrative ───────────────────────────────────────────────────────

export interface NarrativeSnapshot {
  accessStats: unknown;
  keyColumns: unknown;
  filterPatterns: unknown;
  sourceBreakdown: unknown;
  coObjects: unknown;
}

export async function applyUsageNarrative(
  orgId: string,
  contextObjectId: string,
  snapshot: NarrativeSnapshot,
  knownColumns: Set<string>,
  promptVersion: string,
): Promise<{ applied: boolean; reason?: string }> {
  // Build compact user message (~800 tokens)
  const keyColumnsArr = Array.isArray(snapshot.keyColumns)
    ? (snapshot.keyColumns as Array<Record<string, unknown>>)
        .slice(0, 10)
        .map(e => ({ column: e['column'], score: e['score'], filtered_n: e['filtered_n'], lineage_out_n: e['lineage_out_n'] }))
    : [];

  const filterPatternsArr = Array.isArray(snapshot.filterPatterns)
    ? (snapshot.filterPatterns as unknown[]).slice(0, 10)
    : [];

  const coObjectsArr = Array.isArray(snapshot.coObjects)
    ? (snapshot.coObjects as unknown[]).slice(0, 5)
    : [];

  const userMsg = JSON.stringify({
    access_stats: snapshot.accessStats,
    source_breakdown: snapshot.sourceBreakdown,
    top_10_key_columns: keyColumnsArr,
    top_10_filter_patterns: filterPatternsArr,
    top_5_co_objects: coObjectsArr,
    known_columns: Array.from(knownColumns),
  });

  // Bedrock call
  let responseText: string;
  try {
    const client = getBedrockClient();
    const resp = await client.send(new ConverseCommand({
      modelId: NARRATIVE_MODEL_ID,
      messages: [{ role: 'user', content: [{ text: USAGE_NARRATIVE_PROMPT_V1 + '\n\n' + userMsg }] }],
      inferenceConfig: { maxTokens: 400 },
    }));
    responseText = resp.output?.message?.content?.[0]?.text ?? '';
  } catch (err) {
    console.error(`[t3_usage] narrative Bedrock error objectId=${contextObjectId}:`, err);
    return { applied: false, reason: 'bedrock_error' };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    const trimmed = responseText.trim();
    const json = trimmed.startsWith('```')
      ? trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')
      : trimmed;
    parsed = JSON.parse(json);
  } catch {
    return { applied: false, reason: 'parse_error' };
  }

  // Zod validate
  const validated = NarrativeResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return { applied: false, reason: 'validation_error' };
  }
  const result = validated.data;

  // Column containment invariant
  const invalid = result.key_columns.filter(c => !knownColumns.has(c));
  if (invalid.length > 0) {
    console.warn(`[t3_usage] narrative invented_columns objectId=${contextObjectId} offenders=${invalid.join(',')}`);
    return { applied: false, reason: 'invented_columns' };
  }

  // Append-only INSERT (mirrors persistCard in enrich.ts)
  const last = await prisma.platformContextSemantic.findFirst({
    where: { subject_kind: 'object', subject_id: contextObjectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  await prisma.platformContextSemantic.create({
    data: {
      org_id: orgId,
      subject_kind: 'object',
      subject_id: contextObjectId,
      version: nextVersion,
      card: { usage_patterns: result.usage_patterns, key_columns: result.key_columns } as unknown as Prisma.InputJsonValue,
      model_id: NARRATIVE_MODEL_ID,
      prompt_version: promptVersion,
      status: 'observed',
    },
  });

  return { applied: true };
}

// ── getUsageSignalsForEnrich ──────────────────────────────────────────────────

export async function getUsageSignalsForEnrich(
  orgId: string,
  contextObjectId: string,
): Promise<{ hasUsage: boolean; accessStats?: unknown; keyColumns?: unknown; filterPatterns?: unknown; lastT3At?: Date | null }> {
  type UsageRow = { access_stats: unknown; key_columns: unknown; filter_patterns: unknown; captured_at: Date };
  const rows = await prisma.$queryRaw<UsageRow[]>`
    SELECT access_stats, key_columns, filter_patterns, captured_at
    FROM platform_context_usage
    WHERE org_id = ${orgId} AND context_object_id = ${contextObjectId}
    ORDER BY version DESC
    LIMIT 1`;

  if (rows.length === 0) return { hasUsage: false };
  const row = rows[0];
  return {
    hasUsage: true,
    accessStats: row.access_stats,
    keyColumns: row.key_columns,
    filterPatterns: row.filter_patterns,
    lastT3At: row.captured_at,
  };
}

// ── runT3Usage ────────────────────────────────────────────────────────────────

export async function runT3Usage(
  orgId: string,
  sourceId: string,
  opts?: { since?: Date; until?: Date; windowDays?: number; rowCap?: number; lineageRowCap?: number; narrativeTopN?: number },
): Promise<T3UsageResult> {
  // `until` is explicit for continuation jobs, otherwise current time
  const until = opts?.until ?? new Date();
  const rowCap = opts?.rowCap ?? 50_000;
  const lineageRowCap = opts?.lineageRowCap ?? 10_000;
  const narrativeTopN = opts?.narrativeTopN ?? 10;

  // Determine window start: explicit `since`, last harvest, or default 7-day window
  let since: Date;
  if (opts?.since) {
    since = opts.since;
    console.log(`[t3_usage] continuation mode since=${since.toISOString()} until=${until.toISOString()}`);
  } else {
    const defaultWindowDays = opts?.windowDays ?? 7;
    const lastHarvest = await prisma.$queryRawUnsafe<Array<{ max_t3: Date | null }>>(
      `SELECT MAX(last_t3_at) AS max_t3 FROM platform_context_objects WHERE org_id = $1 AND source_id = $2::uuid`,
      orgId,
      sourceId,
    );
    const lastT3 = lastHarvest[0]?.max_t3 ?? null;
    since = lastT3 ?? new Date(until.getTime() - defaultWindowDays * 24 * 60 * 60 * 1000);
    console.log(`[t3_usage] window since=${since.toISOString()} until=${until.toISOString()} (${lastT3 ? 'last harvest' : `${defaultWindowDays}d default`})`);
  }

  const windowDays = Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));

  // ── Load source + connection ────────────────────────────────────────────────
  const sourceRow = await prisma.platformContextSource.findUniqueOrThrow({
    where: { id: sourceId },
  });
  const conn = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: sourceRow.connection_ref },
    select: { id: true, workspace_host: true, default_warehouse_id: true },
  });
  const adapter = new DatabricksAdapter(conn);

  const source = {
    id: sourceRow.id,
    org_id: sourceRow.org_id,
    connection_kind: sourceRow.connection_kind,
    connection_ref: sourceRow.connection_ref,
    display_name: sourceRow.display_name,
    scope_include: Array.isArray(sourceRow.scope_include) ? (sourceRow.scope_include as string[]) : null,
    scope_exclude: Array.isArray(sourceRow.scope_exclude) ? (sourceRow.scope_exclude as string[]) : null,
    harvest_config: null,
    status: sourceRow.status,
    last_sweep_at: sourceRow.last_sweep_at,
  };

  // ── STEP A: windowed query history scan (cursor-paginated, capped) ───────────
  console.log(`[t3_usage] pulling query history: since=${since.toISOString()} until=${until.toISOString()} rowCap=${rowCap}`);
  const { rows: historyRows, nextCursor } = await adapter.pullQueryHistoryWindow(source, since, until, rowCap);
  console.log(`[t3_usage] history rows fetched: ${historyRows.length}${nextCursor ? ` (capped — nextCursor=${nextCursor.toISOString()})` : ''}`);

  // ── STEP A2: lineage scans (before per-object loop — one scan each) ──────────
  const tableLineageRows = await adapter.pullTableLineage(source, windowDays, lineageRowCap);
  console.log(`[t3_usage] table_lineage rows: ${tableLineageRows.length}${tableLineageRows.length === lineageRowCap ? ' (TRUNCATED — hit cap)' : ''}`);

  const columnLineageRows = await adapter.pullColumnLineage(source, windowDays, lineageRowCap);
  console.log(`[t3_usage] column_lineage rows: ${columnLineageRows.length}${columnLineageRows.length === lineageRowCap ? ' (TRUNCATED — hit cap)' : ''}`);

  // ── STEP B: per-object attribution ──────────────────────────────────────────
  const objects = await prisma.platformContextObject.findMany({
    where: { org_id: orgId, source_id: sourceId },
    include: {
      columns: { where: { lifecycle: 'active' }, select: { name: true } },
    },
  });
  console.log(`[t3_usage] objects to process: ${objects.length}`);

  const now = until;
  const windowStart = since;

  let objectsProcessed = 0;
  let snapshotsWritten = 0;
  let skipped = 0;

  // Track written objects for narrative pass (id + n_queries for sorting)
  const writtenObjects: Array<{
    id: string;
    nQueries: number;
    knownColumns: Set<string>;
    snapshot: NarrativeSnapshot;
  }> = [];

  for (const obj of objects) {
    const objectNameLower = (obj.object_name ?? '').toLowerCase();
    if (!objectNameLower) { skipped++; continue; }

    // Case-insensitive plain includes (not regex) against statement_text
    const matched = historyRows.filter(r =>
      (r.statement_text ?? '').toLowerCase().includes(objectNameLower)
    );

    if (matched.length === 0) {
      skipped++;
      continue;
    }

    objectsProcessed++;

    // ── Classify sources ──────────────────────────────────────────────────────
    const classified = matched.map(r => classifyQuerySource(r.query_source));
    const n_jobs = classified.filter(k => k === 'job').length;
    const n_adhoc = classified.filter(k => k === 'adhoc').length;
    const n_dashboard = classified.filter(k => k === 'dashboard').length;
    const n_genie = classified.filter(k => k === 'genie').length;
    const n_alert = classified.filter(k => k === 'alert').length;

    // ── access_stats ──────────────────────────────────────────────────────────
    const executors = new Set(matched.map(r => r.executed_as).filter((e): e is string => e != null));
    const startTimes = matched
      .map(r => r.start_time)
      .filter((t): t is string => t != null)
      .map(t => new Date(t))
      .filter(d => !isNaN(d.getTime()));

    const first_seen = startTimes.length > 0
      ? new Date(Math.min(...startTimes.map(d => d.getTime()))).toISOString()
      : null;
    const last_seen = startTimes.length > 0
      ? new Date(Math.max(...startTimes.map(d => d.getTime()))).toISOString()
      : null;

    const accessStats = {
      n_queries: matched.length,
      n_distinct_executors: executors.size,
      n_jobs,
      n_adhoc,
      n_dashboard,
      n_genie,
      n_alert,
      first_seen,
      last_seen,
      weekly_trend: computeWeeklyTrend(matched, 4),
    };

    // ── source_breakdown ──────────────────────────────────────────────────────
    // Invariant: scheduled + adhoc + dashboard + genie + alert === n_queries
    const sourceBreakdown = {
      scheduled: n_jobs,
      adhoc: n_adhoc,
      dashboard: n_dashboard,
      genie: n_genie,
      alert: n_alert,
    };

    // ── key_columns ───────────────────────────────────────────────────────────
    const knownColumns = new Set(obj.columns.map(c => c.name.toLowerCase()));
    const keyColumns = extractKeyColumns(matched, knownColumns);

    // ── filter_patterns ───────────────────────────────────────────────────────
    const filterPatterns = extractFilterPatterns(matched);

    // ── co_objects ────────────────────────────────────────────────────────────
    const coObjects = extractCoObjects(matched, obj.full_path);

    // ── STEP C: lineage overlay ───────────────────────────────────────────────

    // Table lineage — merge lineage edges into co_objects
    const objPathLower = obj.full_path.toLowerCase();
    const lineageCoTally = new Map<string, number>();
    for (const row of tableLineageRows) {
      const src = (row.source_table_full_name ?? '').toLowerCase();
      const tgt = (row.target_table_full_name ?? '').toLowerCase();
      const other = src === objPathLower ? tgt : tgt === objPathLower ? src : null;
      if (!other || other === objPathLower) continue;
      lineageCoTally.set(other, (lineageCoTally.get(other) ?? 0) + 1);
    }

    // Merge into coObjects: upgrade to 'both' if already present, else add as 'lineage'
    const coByPath = new Map<string, CoObjectEntry>(coObjects.map(e => [e.full_path, { ...e }]));
    for (const [fp, n] of lineageCoTally) {
      const existing = coByPath.get(fp);
      if (existing) {
        existing.kind = 'both';
        if (n > existing.n) existing.n = n;
      } else {
        coByPath.set(fp, { full_path: fp, kind: 'lineage', n });
      }
    }
    const mergedCoObjects: CoObjectEntry[] = [...coByPath.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);

    // Column lineage — build lineage_out_n map for columns of this object
    const lineageOutMap = new Map<string, number>();
    for (const row of columnLineageRows) {
      const src = (row.source_table_full_name ?? '').toLowerCase();
      if (src !== objPathLower) continue;
      const colLower = (row.source_column_name ?? '').toLowerCase();
      if (!knownColumns.has(colLower)) continue;
      lineageOutMap.set(colLower, (lineageOutMap.get(colLower) ?? 0) + 1);
    }

    // Fold lineage_out_n into each key_columns entry
    for (const entry of keyColumns) {
      entry.lineage_out_n = lineageOutMap.get(entry.column) ?? 0;
    }

    // ── STEP D: scoring + drift ───────────────────────────────────────────────

    // Re-score every entry with the blended weights (lineage_out_n now populated)
    for (const entry of keyColumns) {
      entry.score = entry.filtered_n   * T3_SCORE_WEIGHTS.filtered
                  + entry.joined_n     * T3_SCORE_WEIGHTS.joined
                  + entry.lineage_out_n * T3_SCORE_WEIGHTS.lineage_out
                  + entry.projected_n  * T3_SCORE_WEIGHTS.projected;
    }
    keyColumns.sort((a, b) => b.score - a.score);

    // Persist ── version number needed before drift query
    const versionRows = await prisma.$queryRaw<Array<{ next_version: number }>>`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM platform_context_usage
      WHERE org_id = ${orgId} AND context_object_id = ${obj.id}`;
    const nextVersion = Number(versionRows[0]?.next_version ?? 1);

    // Drift against (nextVersion - 1); null for v1
    type PrevUsageRow = { key_columns: unknown; access_stats: unknown };
    let drift: Record<string, unknown> | null = null;
    if (nextVersion > 1) {
      const prevRows = await prisma.$queryRaw<PrevUsageRow[]>`
        SELECT key_columns, access_stats
        FROM platform_context_usage
        WHERE org_id = ${orgId} AND context_object_id = ${obj.id}
          AND version = ${nextVersion - 1}`;
      if (prevRows.length > 0) {
        const prev = prevRows[0];
        const prevStats = (typeof prev.access_stats === 'object' && prev.access_stats !== null
          ? prev.access_stats
          : {}) as Record<string, unknown>;
        const prevKC = (Array.isArray(prev.key_columns) ? prev.key_columns : []) as Array<Record<string, unknown>>;
        const prevScoreMap = new Map(prevKC.map(e => [String(e['column']), Number(e['score'] ?? 0)]));

        const nQueriesDelta = (accessStats.n_queries) - Number(prevStats['n_queries'] ?? 0);
        const trend: 'up' | 'down' | 'stable' = nQueriesDelta > 0 ? 'up' : nQueriesDelta < 0 ? 'down' : 'stable';

        const columnsGaining: string[] = [];
        const columnsLosing: string[] = [];
        for (const entry of keyColumns) {
          if (!prevScoreMap.has(entry.column)) continue;
          const prevScore = prevScoreMap.get(entry.column)!;
          if (entry.score > prevScore) columnsGaining.push(entry.column);
          else if (entry.score < prevScore) columnsLosing.push(entry.column);
        }

        drift = { n_queries_delta: nQueriesDelta, trend, columns_gaining: columnsGaining, columns_losing: columnsLosing };
      }
    }

    // ── Persist ───────────────────────────────────────────────────────────────
    const id = createId();
    await prisma.$executeRaw`
      INSERT INTO platform_context_usage
        (id, org_id, context_object_id, full_path, version,
         window_start, window_end,
         access_stats, source_breakdown, key_columns, filter_patterns, co_objects, drift)
      VALUES
        (${id}, ${orgId}, ${obj.id}, ${obj.full_path}, ${nextVersion},
         ${windowStart}, ${now},
         ${JSON.stringify(accessStats)}::jsonb,
         ${JSON.stringify(sourceBreakdown)}::jsonb,
         ${JSON.stringify(keyColumns)}::jsonb,
         ${JSON.stringify(filterPatterns)}::jsonb,
         ${JSON.stringify(mergedCoObjects)}::jsonb,
         ${drift !== null ? JSON.stringify(drift) : null}::jsonb)`;

    await prisma.platformContextObject.update({
      where: { id: obj.id },
      data: { last_t3_at: now, usage_evidence_at: now },
    });

    snapshotsWritten++;

    // Record for narrative pass
    writtenObjects.push({
      id: obj.id,
      nQueries: accessStats.n_queries,
      knownColumns,
      snapshot: {
        accessStats,
        keyColumns,
        filterPatterns,
        sourceBreakdown,
        coObjects: mergedCoObjects,
      },
    });
  }

  console.log(
    `[t3_usage] done — processed=${objectsProcessed} written=${snapshotsWritten} skipped=${skipped}`,
  );

  // ── STEP E: narrative pass (top-N by n_queries, sequential) ─────────────────
  const topObjects = [...writtenObjects]
    .sort((a, b) => b.nQueries - a.nQueries)
    .slice(0, narrativeTopN);

  let narrativesApplied = 0;
  for (const obj of topObjects) {
    const result = await applyUsageNarrative(
      orgId,
      obj.id,
      obj.snapshot,
      obj.knownColumns,
      NARRATIVE_PROMPT_VERSION,
    );
    console.log(`[t3_usage] narrative objectId=${obj.id} applied=${result.applied}${result.reason ? ` reason=${result.reason}` : ''}`);
    if (result.applied) narrativesApplied++;
  }

  console.log(`[t3_usage] narratives applied=${narrativesApplied} / attempted=${topObjects.length}`);

  return {
    objectsProcessed,
    snapshotsWritten,
    skipped,
    narrativesApplied,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
