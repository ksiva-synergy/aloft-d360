/**
 * Shared Databricks SQL execution — the single guarded chokepoint.
 *
 * Interactive paths (chat `/execute`, Inspector `execute_tool`, dashboards)
 * MUST go through `executeDatabricksSQL`. Export paths use
 * `beginDatabricksSQLExport` — same read-only enforcement, but EXTERNAL_LINKS
 * disposition for large CSV downloads (up to EXPORT_MAX_ROWS).
 *
 * Interactive safety layers (in order, before any network call):
 *
 *   1. READ-ONLY ALLOWLIST  — strip comments AND string literals, then check
 *      the first SQL token is a permitted read-only verb AND the statement
 *      contains no additional semicolons (multi-statement smuggling guard).
 *
 *   2. ROW + BYTE CAPS — row_limit sent to Databricks; wait_timeout capped;
 *      response body byte-capped before parsing.
 *
 *   3. EXTERNAL_LINKS DISPOSITION GUARD — INLINE only; if Databricks returns
 *      external_links chunks, fail with a structured error.
 *
 * Export path: layer 1 + row_limit capped at EXPORT_MAX_ROWS; EXTERNAL_LINKS
 * allowed and streamed chunk-by-chunk (no 4 MB inline body requirement).
 */

import { EXPORT_MAX_ROWS } from './export-limits';
export { EXPORT_MAX_ROWS };

/** Export poll budget — must stay under Next route `maxDuration` (300s). */
export const EXPORT_POLL_TIMEOUT_MS = 4 * 60 * 1000;
const EXPORT_FETCH_TIMEOUT_MS = 60_000;

// ── Safety constants ──────────────────────────────────────────────────────────

export const MAX_ROWS = Math.min(
  parseInt(process.env.DATABRICKS_MAX_ROWS ?? '1000', 10),
  10_000,
);
// Default timeout for interactive/UI queries. Profiling queries may request up to PROFILE_MAX_WAIT_SECS.
export const MAX_WAIT_SECS = Math.min(
  parseInt(process.env.DATABRICKS_MAX_WAIT_SECS ?? '30', 10),
  120,
);
// Databricks API hard limit for wait_timeout is 50s. For longer queries we use async polling.
export const DATABRICKS_API_MAX_WAIT_SECS = 50;
export const MAX_INLINE_BYTES = 4 * 1024 * 1024; // 4 MB

// Async polling: initial poll delay + backoff cap for long-running background queries.
const ASYNC_POLL_INITIAL_MS = 2_000;
const ASYNC_POLL_MAX_MS = 10_000;
// Total wall-clock budget for async polling before giving up (10 minutes).
const ASYNC_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Read-only verb allowlist.
 * WITH is safe on Databricks SQL specifically — CTEs are SELECT-only in this
 * engine. If this module is ever used against a non-Databricks SQL endpoint
 * (Postgres, Spark SQL, etc.) this assumption must be re-evaluated.
 */
const READ_ONLY_VERBS = new Set([
  'SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'USE',
]);

// ── Typed errors ──────────────────────────────────────────────────────────────

export class ReadOnlyViolationError extends Error {
  constructor(
    public readonly verb: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReadOnlyViolationError';
  }
}

export class MultiStatementError extends Error {
  constructor() {
    super(
      'Multi-statement input detected (semicolon outside a string literal). ' +
      'Only a single read-only statement per call is permitted.',
    );
    this.name = 'MultiStatementError';
  }
}

export class ExternalLinksError extends Error {
  constructor() {
    super(
      'Result set is too large for inline delivery (Databricks returned EXTERNAL_LINKS). ' +
      'Add a LIMIT clause to reduce row count below the inline threshold.',
    );
    this.name = 'ExternalLinksError';
  }
}

// ── Read-only enforcement ─────────────────────────────────────────────────────

/**
 * Strip SQL string literals (single-quoted, with '' escaping) from a statement,
 * replacing them with a placeholder so subsequent checks don't misread their
 * contents as SQL keywords or semicolons.
 */
function stripStringLiterals(sql: string): string {
  // Replace 'content' (including escaped '' within) with a placeholder.
  // The regex handles '' as an escaped quote inside a literal.
  return sql.replace(/'(?:[^']|'')*'/g, "'__STR__'");
}

/**
 * Strip block comments (/* … *\/) and line comments (-- …).
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Enforce that the statement:
 *   a) starts with a permitted read-only verb (after stripping comments)
 *   b) does not contain a semicolon that is not a trailing terminator
 *      (multi-statement smuggling guard — checked after stripping both
 *       comments and string literals to avoid false positives on ';' in data)
 *
 * Throws ReadOnlyViolationError or MultiStatementError on failure.
 */
export function enforceReadOnly(statement: string): void {
  // Step 1: strip comments to get the true first token
  const withoutComments = stripComments(statement);
  const trimmed = withoutComments.trim();
  const firstToken = trimmed.split(/\s+/)[0].toUpperCase();

  if (!READ_ONLY_VERBS.has(firstToken)) {
    throw new ReadOnlyViolationError(
      firstToken,
      `Statement type '${firstToken}' is not permitted. ` +
      `Only read-only statements are allowed: SELECT, WITH, SHOW, DESCRIBE, EXPLAIN.`,
    );
  }

  // Step 2: multi-statement smuggling guard
  // Strip BOTH comments and string literals, then look for any semicolon that
  // isn't the very last non-whitespace character (trailing terminators are ok).
  const stripped = stripStringLiterals(withoutComments).trim();
  // Remove a single trailing semicolon if present
  const withoutTrailing = stripped.endsWith(';') ? stripped.slice(0, -1).trimEnd() : stripped;

  if (withoutTrailing.includes(';')) {
    throw new MultiStatementError();
  }
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface DatabricksExecuteInput {
  statement: string;
  waitTimeoutSecs?: number; // caller's requested timeout — will be capped
  rowLimit?: number;        // override MAX_ROWS for this specific call (e.g. inventory)
  /**
   * When true, the initial request uses on_wait_timeout=CONTINUE and we poll
   * via GET /api/2.0/sql/statements/:id until the query completes (up to
   * pollTimeoutMs, default ASYNC_POLL_TIMEOUT_MS). Use for long-running
   * background queries (e.g. system.query.history pagination) that regularly
   * exceed the 50s API cap.
   */
  asyncPolling?: boolean;
  /**
   * Wall-clock budget for async polling before giving up, in ms. Defaults to
   * ASYNC_POLL_TIMEOUT_MS (10 min). Callers that run async queries inside a
   * larger sequential job (e.g. per-object view profiling) should pass a much
   * smaller budget so one pathological query can't stall the whole job — on
   * timeout the statement is CANCELED server-side so it stops consuming the
   * warehouse. Only honored when asyncPolling is true.
   */
  pollTimeoutMs?: number;
}

export interface DatabricksExecuteResult {
  rows: Record<string, unknown>[];
  row_count: number;
  columns: { name: string; type_name: string }[];
  statement_id: string;
  truncated: boolean;
  truncated_at?: number;
}

// ── Shared guarded execution function ────────────────────────────────────────

/**
 * Execute a read-only SQL statement against a Databricks SQL warehouse.
 *
 * This is the ONLY function that should ever call the Databricks Statement
 * Execution API. All safety layers are applied here.
 *
 * @param connectionId   - ID of the PlatformDatabricksConnection row
 * @param workspaceHost  - Databricks workspace hostname
 * @param warehouseId    - SQL warehouse ID
 * @param token          - Short-lived OAuth M2M access token (never logged)
 * @param input          - { statement, waitTimeoutSecs? }
 */
export async function executeDatabricksSQL(
  _connectionId: string,
  workspaceHost: string,
  warehouseId: string,
  token: string,
  input: DatabricksExecuteInput,
): Promise<DatabricksExecuteResult> {
  // ── Safety layer 1: read-only + multi-statement enforcement ──────────────
  // This MUST stay here, not in the HTTP route handler.
  // Any future caller (workbench execute_tool, cron jobs, etc.) goes through
  // this function and therefore through this check automatically.
  enforceReadOnly(input.statement);

  const host = workspaceHost.replace(/^https?:\/\//, '');

  if (input.asyncPolling) {
    return executeDatabricksSQLAsync(host, warehouseId, token, input);
  }

  // ── Safety layer 2a: wait_timeout cap ────────────────────────────────────
  const waitSecs = Math.min(
    input.waitTimeoutSecs !== undefined ? input.waitTimeoutSecs : MAX_WAIT_SECS,
    MAX_WAIT_SECS,
  );
  const waitTimeout = `${waitSecs}s`;

  // ── Call Databricks Statement Execution API ───────────────────────────────
  const url = `https://${host}/api/2.0/sql/statements`;

  const reqController = new AbortController();
  const reqTimeout = setTimeout(() => reqController.abort(), (waitSecs + 5) * 1000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statement: input.statement,
        warehouse_id: warehouseId,
        wait_timeout: waitTimeout,
        on_wait_timeout: 'CANCEL',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
        row_limit: input.rowLimit ?? MAX_ROWS,  // Safety layer 2b: row cap at warehouse
      }),
      signal: reqController.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Databricks SQL API '${host}' did not respond within 35 s — check network connectivity or firewall rules`
        : `Network error reaching Databricks SQL API '${host}': ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(reqTimeout);
  }

  // ── Safety layer 2c: byte cap on content-length (fast path) ──────────────
  const contentLength = parseInt(resp.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_INLINE_BYTES) {
    throw new Error(
      `Response body (${contentLength} bytes) exceeds the ${MAX_INLINE_BYTES}-byte inline cap. ` +
      'Narrow your query or add a LIMIT clause.',
    );
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '(no body)');
    throw new Error(`Statement execution returned ${resp.status}: ${errText}`);
  }

  const rawText = await resp.text();

  // ── Safety layer 2d: byte cap on actual body ──────────────────────────────
  if (rawText.length > MAX_INLINE_BYTES) {
    throw new Error(
      `Response body (${rawText.length} bytes) exceeds the ${MAX_INLINE_BYTES}-byte inline cap. ` +
      'Narrow your query or add a LIMIT clause.',
    );
  }

  return parseStatementResponse(rawText);
}

// ── Shared response parser ────────────────────────────────────────────────────

type ExternalLinkEntry = {
  external_link?: string;
  chunk_index?: number;
  next_chunk_index?: number;
  row_count?: number;
  row_offset?: number;
  byte_count?: number;
  expiration?: string;
};

type RawStatementResponse = {
  statement_id: string;
  status: { state: string; error?: { message: string } };
  manifest?: {
    truncated?: boolean;
    total_row_count?: number;
    total_chunk_count?: number;
    schema?: { columns?: { name: string; type_name: string }[] };
    chunks?: { chunk_index: number; row_count: number; row_offset: number }[];
  };
  result?: {
    data_array?: unknown[][];
    external_links?: ExternalLinkEntry[];
    next_chunk_index?: number;
    chunk_index?: number;
  };
};

function parseStatementResponse(rawText: string): DatabricksExecuteResult {
  const raw = JSON.parse(rawText) as RawStatementResponse;

  const state = raw.status?.state;
  if (state === 'FAILED' || state === 'CANCELED') {
    throw new Error(`Query ${state}: ${raw.status?.error?.message ?? state}`);
  }
  if (state !== 'SUCCEEDED') {
    throw new Error(`Unexpected statement state: ${state}`);
  }

  // ── Safety layer 3: EXTERNAL_LINKS disposition guard ─────────────────────
  if (raw.result?.external_links && raw.result.external_links.length > 0) {
    throw new ExternalLinksError();
  }

  const columns: { name: string; type_name: string }[] =
    raw.manifest?.schema?.columns?.map(c => ({ name: c.name, type_name: c.type_name })) ?? [];

  const dataArray = raw.result?.data_array ?? [];
  const rows: Record<string, unknown>[] = dataArray.map(row =>
    Object.fromEntries(columns.map((col, i) => [col.name, (row as unknown[])[i]])),
  );

  const truncated = raw.manifest?.truncated ?? false;

  return {
    rows,
    row_count: rows.length,
    columns,
    statement_id: raw.statement_id,
    truncated,
    ...(truncated ? { truncated_at: MAX_ROWS } : {}),
  };
}

// ── Async polling execution ───────────────────────────────────────────────────
// Used by long-running background queries (e.g. system.query.history pagination)
// that regularly exceed the 50s on_wait_timeout=CANCEL limit. Instead of letting
// the query get canceled, we submit with on_wait_timeout=CONTINUE and poll
// GET /api/2.0/sql/statements/:id with exponential backoff until completion.

async function executeDatabricksSQLAsync(
  host: string,
  warehouseId: string,
  token: string,
  input: DatabricksExecuteInput,
): Promise<DatabricksExecuteResult> {
  const url = `https://${host}/api/2.0/sql/statements`;

  // Submit with wait_timeout=50s + CONTINUE so we get a statement_id back
  // immediately when the query doesn't finish in 50s (rather than CANCEL).
  const submitResp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      statement: input.statement,
      warehouse_id: warehouseId,
      wait_timeout: `${DATABRICKS_API_MAX_WAIT_SECS}s`,
      on_wait_timeout: 'CONTINUE',
      format: 'JSON_ARRAY',
      disposition: 'INLINE',
      row_limit: input.rowLimit ?? MAX_ROWS,
    }),
  });

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '(no body)');
    throw new Error(`Async statement submission returned ${submitResp.status}: ${errText}`);
  }

  const submitText = await submitResp.text();
  const submitRaw = JSON.parse(submitText) as RawStatementResponse;

  // Fast path: already done within the 50s wait
  if (submitRaw.status?.state === 'SUCCEEDED') {
    return parseStatementResponse(submitText);
  }
  if (submitRaw.status?.state === 'FAILED' || submitRaw.status?.state === 'CANCELED') {
    throw new Error(`Async query ${submitRaw.status.state}: ${submitRaw.status?.error?.message ?? submitRaw.status.state}`);
  }

  const statementId = submitRaw.statement_id;
  if (!statementId) {
    throw new Error('Async submission did not return a statement_id');
  }

  // Poll with exponential backoff
  const pollUrl = `https://${host}/api/2.0/sql/statements/${statementId}`;
  const pollTimeoutMs = input.pollTimeoutMs ?? ASYNC_POLL_TIMEOUT_MS;
  const deadline = Date.now() + pollTimeoutMs;
  let delayMs = ASYNC_POLL_INITIAL_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 1.5, ASYNC_POLL_MAX_MS);

    const pollResp = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!pollResp.ok) {
      const errText = await pollResp.text().catch(() => '(no body)');
      throw new Error(`Async poll returned ${pollResp.status}: ${errText}`);
    }

    const pollText = await pollResp.text();
    const pollRaw = JSON.parse(pollText) as RawStatementResponse;
    const pollState = pollRaw.status?.state;

    if (pollState === 'SUCCEEDED') {
      // Byte cap on async response body
      if (pollText.length > MAX_INLINE_BYTES) {
        throw new Error(
          `Async response body (${pollText.length} bytes) exceeds the ${MAX_INLINE_BYTES}-byte inline cap. ` +
          'Narrow your query or add a LIMIT clause.',
        );
      }
      return parseStatementResponse(pollText);
    }

    if (pollState === 'FAILED' || pollState === 'CANCELED') {
      throw new Error(`Async query ${pollState}: ${pollRaw.status?.error?.message ?? pollState}`);
    }

    // Still PENDING or RUNNING — keep polling
  }

  // Budget exhausted. On CONTINUE the statement keeps executing server-side even
  // after we stop polling, so cancel it to stop it consuming the warehouse
  // (single-cluster warehouses can otherwise be saturated by an abandoned query).
  // Best-effort: a cancel failure must not mask the timeout error.
  await fetch(`${pollUrl}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);

  throw new Error(`Async query timed out after ${pollTimeoutMs / 1000}s (statement_id=${statementId})`);
}

// ── DDL execution (metric view apply path only) ───────────────────────────────

/**
 * Execute a single DDL statement (CREATE OR REPLACE VIEW, CREATE SCHEMA IF NOT
 * EXISTS, etc.) against a Databricks SQL warehouse.
 *
 * This function intentionally bypasses the READ_ONLY_VERBS guard that
 * `executeDatabricksSQL` enforces — DDL is never read-only. It is restricted to
 * the metric-view apply path (`src/lib/semantic/metric-views.ts`) and MUST NOT
 * be used for any query that originates from user input. No row cap is applied
 * because DDL returns no rows.
 *
 * The same HTTP API as `executeDatabricksSQL`, but with:
 *   - No read-only enforcement
 *   - No row_limit / INLINE disposition (DDL doesn't return rows)
 *   - No EXTERNAL_LINKS guard
 */
export async function executeDatabricksDDL(
  _connectionId: string,
  workspaceHost: string,
  warehouseId: string,
  token: string,
  statement: string,
): Promise<{ statement_id: string }> {
  const host = workspaceHost.replace(/^https?:\/\//, '');
  const url = `https://${host}/api/2.0/sql/statements`;

  const reqController = new AbortController();
  const reqTimeout = setTimeout(() => reqController.abort(), 60_000);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statement,
        warehouse_id: warehouseId,
        wait_timeout: '60s',
        on_wait_timeout: 'CANCEL',
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
      }),
      signal: reqController.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? `Databricks DDL API '${host}' timed out after 60s`
        : `Network error reaching Databricks DDL API '${host}': ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(reqTimeout);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '(no body)');
    throw new Error(`DDL execution returned ${resp.status}: ${errText}`);
  }

  const raw = JSON.parse(await resp.text()) as {
    statement_id: string;
    status: { state: string; error?: { message: string } };
  };

  const state = raw.status?.state;
  if (state === 'FAILED' || state === 'CANCELED') {
    throw new Error(`DDL ${state}: ${raw.status?.error?.message ?? state}`);
  }
  if (state !== 'SUCCEEDED') {
    throw new Error(`Unexpected DDL statement state: ${state}`);
  }

  return { statement_id: raw.statement_id };
}

// ── CSV export path (EXTERNAL_LINKS, up to EXPORT_MAX_ROWS) ───────────────────

export interface DatabricksExportInput {
  statement: string;
  /** Requested max rows; clamped to EXPORT_MAX_ROWS. Default EXPORT_MAX_ROWS. */
  maxRows?: number;
  /** Async poll budget in ms. Default EXPORT_POLL_TIMEOUT_MS (4 min). */
  pollTimeoutMs?: number;
}

export interface DatabricksExportMeta {
  statement_id: string;
  columns: { name: string; type_name: string }[];
  /** True if Databricks truncated at row_limit or we stopped at EXPORT_MAX_ROWS. */
  truncated: boolean;
  /** Total rows Databricks reported (may exceed what we stream if truncated). */
  total_row_count: number;
  row_limit: number;
}

export interface DatabricksExportHandle {
  meta: DatabricksExportMeta;
  /**
   * Yields data rows as positional arrays aligned to `meta.columns`.
   * Stops after `meta.row_limit` rows. Does not buffer the full result set.
   */
  rows(): AsyncGenerator<unknown[]>;
}

/**
 * Start a read-only SQL export against Databricks using EXTERNAL_LINKS disposition.
 * Returns metadata (available before streaming) plus an async row iterator.
 *
 * Interactive callers must continue to use `executeDatabricksSQL` (INLINE only).
 *
 * Poll budget defaults to EXPORT_POLL_TIMEOUT_MS (4 min) so we fail before the
 * Next.js route maxDuration (300s) silently kills the request.
 */
export async function beginDatabricksSQLExport(
  _connectionId: string,
  workspaceHost: string,
  warehouseId: string,
  token: string,
  input: DatabricksExportInput,
): Promise<DatabricksExportHandle> {
  enforceReadOnly(input.statement);

  const rowLimit = Math.min(
    Math.max(1, input.maxRows ?? EXPORT_MAX_ROWS),
    EXPORT_MAX_ROWS,
  );
  const host = workspaceHost.replace(/^https?:\/\//, '');
  const pollTimeoutMs = input.pollTimeoutMs ?? EXPORT_POLL_TIMEOUT_MS;

  const succeeded = await submitAndAwaitExport(host, warehouseId, token, input.statement, rowLimit, pollTimeoutMs);

  const columns: { name: string; type_name: string }[] =
    succeeded.manifest?.schema?.columns?.map(c => ({ name: c.name, type_name: c.type_name })) ?? [];

  const totalRowCount = succeeded.manifest?.total_row_count ?? 0;
  const warehouseTruncated = succeeded.manifest?.truncated ?? false;

  const meta: DatabricksExportMeta = {
    statement_id: succeeded.statement_id,
    columns,
    truncated: warehouseTruncated || totalRowCount > rowLimit,
    total_row_count: totalRowCount,
    row_limit: rowLimit,
  };

  return {
    meta,
    rows: () => iterateExportRows(host, token, succeeded, rowLimit),
  };
}

function abortableTimeout(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const signal = abortableTimeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      isAbort
        ? `${label} timed out after ${Math.round(timeoutMs / 1000)}s`
        : `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function submitAndAwaitExport(
  host: string,
  warehouseId: string,
  token: string,
  statement: string,
  rowLimit: number,
  pollTimeoutMs: number,
): Promise<RawStatementResponse> {
  const url = `https://${host}/api/2.0/sql/statements`;

  const submitResp = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statement,
        warehouse_id: warehouseId,
        wait_timeout: `${DATABRICKS_API_MAX_WAIT_SECS}s`,
        on_wait_timeout: 'CONTINUE',
        format: 'JSON_ARRAY',
        disposition: 'EXTERNAL_LINKS',
        row_limit: rowLimit,
      }),
    },
    (DATABRICKS_API_MAX_WAIT_SECS + 20) * 1000,
    'Export statement submission',
  );

  if (!submitResp.ok) {
    const errText = await submitResp.text().catch(() => '(no body)');
    throw new Error(`Export statement submission returned ${submitResp.status}: ${errText}`);
  }

  const submitRaw = (await submitResp.json()) as RawStatementResponse;
  const submitState = submitRaw.status?.state;

  if (submitState === 'SUCCEEDED') return submitRaw;
  if (submitState === 'FAILED' || submitState === 'CANCELED') {
    throw new Error(`Export query ${submitState}: ${submitRaw.status?.error?.message ?? submitState}`);
  }

  const statementId = submitRaw.statement_id;
  if (!statementId) {
    throw new Error('Export submission did not return a statement_id');
  }

  console.info(
    `[databricks-export] polling statement_id=${statementId} row_limit=${rowLimit} budget_s=${Math.round(pollTimeoutMs / 1000)}`,
  );

  const pollUrl = `https://${host}/api/2.0/sql/statements/${statementId}`;
  const deadline = Date.now() + pollTimeoutMs;
  let delayMs = ASYNC_POLL_INITIAL_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 1.5, ASYNC_POLL_MAX_MS);

    const pollResp = await fetchWithTimeout(
      pollUrl,
      { headers: { Authorization: `Bearer ${token}` } },
      EXPORT_FETCH_TIMEOUT_MS,
      'Export poll',
    );
    if (!pollResp.ok) {
      const errText = await pollResp.text().catch(() => '(no body)');
      throw new Error(`Export poll returned ${pollResp.status}: ${errText}`);
    }

    const pollRaw = (await pollResp.json()) as RawStatementResponse;
    const pollState = pollRaw.status?.state;

    if (pollState === 'SUCCEEDED') return pollRaw;
    if (pollState === 'FAILED' || pollState === 'CANCELED') {
      throw new Error(`Export query ${pollState}: ${pollRaw.status?.error?.message ?? pollState}`);
    }
  }

  await fetch(`${pollUrl}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);

  throw new Error(
    `Export query timed out after ${Math.round(pollTimeoutMs / 1000)}s on Databricks ` +
      `(statement_id=${statementId}). Try a narrower filter, drop ORDER BY, or add LIMIT.`,
  );
}

async function* iterateExportRows(
  host: string,
  token: string,
  initial: RawStatementResponse,
  rowLimit: number,
): AsyncGenerator<unknown[]> {
  let yielded = 0;
  let chunkIndex = 0;
  let result: RawStatementResponse['result'] | undefined = initial.result;
  const statementId = initial.statement_id;
  const totalChunks = initial.manifest?.total_chunk_count;

  while (yielded < rowLimit) {
    if (!result) break;

    const rows = await materializeChunkRows(result);
    for (const row of rows) {
      if (yielded >= rowLimit) return;
      yield row;
      yielded++;
    }

    const nextFromLink = result.external_links?.[0]?.next_chunk_index;
    const nextFromResult = result.next_chunk_index;
    const nextIndex =
      typeof nextFromLink === 'number'
        ? nextFromLink
        : typeof nextFromResult === 'number'
          ? nextFromResult
          : typeof totalChunks === 'number' && chunkIndex + 1 < totalChunks
            ? chunkIndex + 1
            : undefined;

    if (typeof nextIndex !== 'number') break;

    chunkIndex = nextIndex;
    result = await fetchExportChunk(host, token, statementId, chunkIndex);
  }
}

async function fetchExportChunk(
  host: string,
  token: string,
  statementId: string,
  chunkIndex: number,
): Promise<RawStatementResponse['result']> {
  const url = `https://${host}/api/2.0/sql/statements/${statementId}/result/chunks/${chunkIndex}`;
  const resp = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    EXPORT_FETCH_TIMEOUT_MS,
    `Export chunk ${chunkIndex}`,
  );
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '(no body)');
    throw new Error(`Export chunk ${chunkIndex} returned ${resp.status}: ${errText}`);
  }
  const raw = (await resp.json()) as RawStatementResponse['result'] & {
    external_links?: ExternalLinkEntry[];
    data_array?: unknown[][];
    next_chunk_index?: number;
  };
  // Chunk endpoint returns the nested result shape (not a full statement response).
  return raw;
}

/**
 * Resolve a chunk's rows: prefer INLINE data_array; otherwise fetch EXTERNAL_LINKS
 * URLs (presigned — no Authorization header) and parse JSON_ARRAY.
 */
async function materializeChunkRows(
  result: NonNullable<RawStatementResponse['result']>,
): Promise<unknown[][]> {
  if (result.data_array && result.data_array.length > 0) {
    return result.data_array;
  }

  const links = result.external_links ?? [];
  if (links.length === 0) return [];

  const all: unknown[][] = [];
  for (const link of links) {
    if (!link.external_link) continue;
    const resp = await fetchWithTimeout(
      link.external_link,
      undefined,
      EXPORT_FETCH_TIMEOUT_MS,
      'Export external_link fetch',
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '(no body)');
      throw new Error(`Export external_link fetch returned ${resp.status}: ${errText}`);
    }
    const parsed = (await resp.json()) as unknown;
    if (Array.isArray(parsed)) {
      // JSON_ARRAY format: array of row arrays
      for (const row of parsed) {
        if (Array.isArray(row)) all.push(row as unknown[]);
      }
    }
  }
  return all;
}

