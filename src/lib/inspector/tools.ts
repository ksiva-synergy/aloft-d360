import { prisma } from '@/lib/db';
import { executeDatabricksSQL, ReadOnlyViolationError, MultiStatementError, ExternalLinksError } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';
import { profileResultSet } from '@/lib/studio/profiler';
import type { QueryResult } from '@/hooks/useInspectorChat';
import type { SemanticQuery } from '@/lib/semantic/types';

export type ToolEmit = (event: Record<string, unknown>) => void;

/**
 * Optional context passed from the chat route to executeInspectorTool.
 * Carries the query results accumulated so far in this turn/session and
 * the current model ID (Bedrock model ID string).
 */
export interface InspectorToolContext {
  queryResults: QueryResult[];
  model: string;
  lastUserMessage: string;
  sessionId: string;
  /** Databricks connectionId resolved once at session init. Null if no active connection. */
  connectionId: string | null;
}

/**
 * Robustly parse execute_tool's `args` field.
 * The model occasionally double-serialises the object as a JSON string;
 * this handles both the correct { statement: "..." } object form and the
 * broken "{\\"statement\\":\\"...\\"}" string form.
 */
function parseToolArgs(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === 'string') {
    try { return JSON.parse(rawArgs.trim()) as Record<string, unknown>; } catch { return {}; }
  }
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>;
  }
  return {};
}

type ToolCatalogRow = {
  id: string;
  name: string;
  slug: string | null;
  type: string | null;
  config: Record<string, unknown> | null;
  status: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: string): boolean { return UUID_RE.test(v); }

function parseRawCatalogRow(row: Record<string, unknown>): ToolCatalogRow {
  let config: Record<string, unknown> | null = null;
  if (typeof row.config === 'string') {
    try { config = JSON.parse(row.config); } catch { config = null; }
  } else if (row.config && typeof row.config === 'object') {
    config = row.config as Record<string, unknown>;
  }
  return {
    id: String(row.id),
    name: String(row.name),
    slug: row.slug ? String(row.slug) : null,
    type: row.type ? String(row.type) : null,
    config,
    status: row.status ? String(row.status) : null,
  };
}

export async function resolveToolCatalogEntry(toolSlug: string): Promise<ToolCatalogRow | null> {
  const effectiveSlug = toolSlug || 'synergy_dwh';

  const bySlug = await prisma.$queryRaw<ToolCatalogRow[]>`
    SELECT id::text as id, name, slug, type, description, config::text, status
    FROM tool_catalog WHERE slug = ${effectiveSlug} LIMIT 1`;
  if (bySlug.length > 0) return parseRawCatalogRow(bySlug[0] as Record<string, unknown>);

  if (isUUID(effectiveSlug)) {
    const byId = await prisma.$queryRaw<ToolCatalogRow[]>`
      SELECT id::text as id, name, slug, type, description, config::text, status
      FROM tool_catalog WHERE id::text = ${effectiveSlug} LIMIT 1`;
    if (byId.length > 0) return parseRawCatalogRow(byId[0] as Record<string, unknown>);
  }

  const byName = await prisma.$queryRaw<ToolCatalogRow[]>`
    SELECT id::text as id, name, slug, type, description, config::text, status
    FROM tool_catalog WHERE name = ${effectiveSlug} AND type = 'db_query' LIMIT 1`;
  if (byName.length > 0) return parseRawCatalogRow(byName[0] as Record<string, unknown>);

  const connByName = await prisma.platformDatabricksConnection.findFirst({ where: { name: effectiveSlug } });
  if (connByName) {
    const derivedSlug = `databricks-${connByName.id}`;
    const byDerived = await prisma.$queryRaw<ToolCatalogRow[]>`
      SELECT id::text as id, name, slug, type, description, config::text, status
      FROM tool_catalog WHERE slug = ${derivedSlug} LIMIT 1`;
    if (byDerived.length > 0) return parseRawCatalogRow(byDerived[0] as Record<string, unknown>);
  }

  const first = await prisma.$queryRaw<ToolCatalogRow[]>`
    SELECT id::text as id, name, slug, type, description, config::text, status
    FROM tool_catalog WHERE type = 'db_query' AND status = 'active' LIMIT 1`;
  if (first.length > 0) return parseRawCatalogRow(first[0] as Record<string, unknown>);

  return null;
}

/**
 * Execute a named Inspector tool. Returns a JSON-serialised string result.
 * `emit` is optional — pass a no-op for benchmark/non-streaming callers.
 * `context` is optional — carries query results and model for emit_chart.
 */
export async function executeInspectorTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  callId: string,
  emit: ToolEmit = () => {},
  context?: InspectorToolContext,
): Promise<string> {
  // ── emit_disambiguation ─────────────────────────────────────────────────────
  // Structured, interactive form of "refuse rather than guess". Surfaces the
  // agent's candidate options to the client as clickable chips and stops the
  // turn — the agent must wait for the user to pick before charting.
  if (toolName === 'emit_disambiguation') {
    const originalTerm = typeof toolInput.originalTerm === 'string' ? toolInput.originalTerm : '';
    const candidatesRaw = Array.isArray(toolInput.candidates) ? toolInput.candidates : [];
    const message = typeof toolInput.message === 'string' ? toolInput.message : '';
    emit({
      type: 'semantic_disambiguation',
      originalTerm,
      candidates: candidatesRaw,
      message,
    });
    // Tell the model the card is shown; it should end its turn and await the pick.
    return JSON.stringify({
      ok: true,
      surfaced: true,
      note: 'Disambiguation options shown to the user. End your turn now and wait for the user to choose.',
    });
  }

  // ── emit_semantic_chart ─────────────────────────────────────────────────────
  if (toolName === 'emit_semantic_chart') {
    const query = toolInput as unknown as SemanticQuery;
    const connectionId = context?.connectionId ?? null;
    if (!connectionId) {
      const errMsg = 'No active Databricks connection — cannot execute semantic query.';
      emit({ type: 'semantic_chart_error', reason: errMsg });
      return JSON.stringify({ error: errMsg });
    }
    try {
      const { runSemanticChartPipeline } = await import('./chart-pipeline');
      const result = await runSemanticChartPipeline({
        query,
        connectionId,
        model: context?.model ?? 'us.anthropic.claude-sonnet-4-6',
        sessionId: context?.sessionId ?? '',
        intent: context?.lastUserMessage ?? '',
        // Progressive streaming: relay plan / SQL / stage events to the SSE
        // stream as they become available, ahead of the final chart result.
        onProgress: (ev) => emit({ ...ev }),
      });
      if (result.ok) {
        emit({
          type: 'semantic_chart_result',
          sql: result.sql,
          spec: result.spec,
          option: result.option,
          semanticQuery: query,
          // Trust-spine metadata (TrustPanel) + smart-defaults rationale.
          rowCount: result.rowCount,
          executedAt: result.executedAt,
          definitionsUsed: result.definitionsUsed,
          resolvedLabels: result.resolvedLabels,
          recommendation: result.recommendation,
          sessionId: context?.sessionId,
        });
        return JSON.stringify({ ok: true, sql: result.sql, spec: result.spec });
      } else {
        emit({ type: 'semantic_chart_error', reason: result.reason, errors: result.errors });
        return JSON.stringify({ error: result.reason });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Semantic chart pipeline failed';
      emit({ type: 'semantic_chart_error', reason: msg });
      return JSON.stringify({ error: msg });
    }
  }

  // ── emit_chart ──────────────────────────────────────────────────────────────
  if (toolName === 'emit_chart') {
    const qrs = context?.queryResults ?? [];
    const lastQR = qrs.length > 0 ? qrs[qrs.length - 1] : null;

    if (!lastQR) {
      const errMsg = 'No query result available to chart — run a query first.';
      emit({ type: 'chart_error', reason: errMsg, errors: [], attempts: 0 });
      return JSON.stringify({ error: errMsg });
    }

    // Use cached profiles if present; otherwise compute them now
    const profileResult = lastQR.cachedProfiles
      ? { profiles: lastQR.cachedProfiles, columnsTruncated: lastQR.columns.length > 50, rowsSampled: lastQR.rows.length }
      : profileResultSet(lastQR.columns, lastQR.rows);

    const userIntent = context?.lastUserMessage
      ?? (toolInput.title as string | undefined)
      ?? 'chart this data';

    const model = context?.model ?? 'us.anthropic.claude-sonnet-4-6';
    const sessionId = context?.sessionId ?? '';

    try {
      const { runChartPipeline } = await import('./chart-pipeline');
      const pipelineResult = await runChartPipeline({
        userIntent,
        queryResult: lastQR,
        profileResult,
        model,
        sessionId,
      });

      if (pipelineResult.ok) {
        emit({
          type: 'chart_spec',
          spec: pipelineResult.spec,
          option: pipelineResult.option,
          repaired: pipelineResult.repaired,
          attempts: pipelineResult.attempts,
          sessionId,
        });
        return JSON.stringify({ ok: true, spec: pipelineResult.spec, repaired: pipelineResult.repaired, attempts: pipelineResult.attempts });
      } else {
        emit({
          type: 'chart_error',
          reason: pipelineResult.reason,
          errors: pipelineResult.errors,
          attempts: pipelineResult.attempts,
        });
        return JSON.stringify({ error: pipelineResult.reason, attempts: pipelineResult.attempts });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chart pipeline failed';
      emit({ type: 'chart_error', reason: msg, errors: [], attempts: 0 });
      return JSON.stringify({ error: msg });
    }
  }

  if (toolName === 'execute_tool') {
    try {
      const toolSlug = toolInput.tool_name as string;
      const catalogEntry = await resolveToolCatalogEntry(toolSlug);

      if (!catalogEntry) {
        const errMsg = `Tool '${toolSlug}' not found. Make sure a db_query tool is registered in the catalog.`;
        emit({ type: 'tool_call_error', callId, error: errMsg, retryable: false });
        return JSON.stringify({ error: errMsg });
      }

      if (catalogEntry.type === 'db_query') {
        const cfg = catalogEntry.config as Record<string, string> | null;
        const connectionId = cfg?.connection_id;
        if (!connectionId) {
          const errMsg = `db_query tool '${toolSlug}' has no connection_id in config`;
          emit({ type: 'tool_call_error', callId, error: errMsg, retryable: false });
          return JSON.stringify({ error: errMsg });
        }

        const rawArgs = toolInput.args ?? {};
        const args: Record<string, unknown> = parseToolArgs(rawArgs);
        const rawStatement = args.statement ?? args.sql ?? args.query;
        const statement = typeof rawStatement === 'string' ? rawStatement : undefined;
        if (!statement) {
          const errMsg = `execute_tool: 'statement' not found in args. Pass args as a JSON object with a "statement" key, e.g. {"statement": "SELECT ..."}. Received args type: ${typeof rawArgs}`;
          emit({ type: 'tool_call_error', callId, error: errMsg, retryable: true });
          return JSON.stringify({ error: errMsg });
        }

        const conn = await prisma.platformDatabricksConnection.findUnique({ where: { id: connectionId } });
        if (!conn) {
          const errMsg = `Databricks connection '${connectionId}' not found`;
          emit({ type: 'tool_call_error', callId, error: errMsg, retryable: false });
          return JSON.stringify({ error: errMsg });
        }
        if (conn.status !== 'active') {
          const errMsg = `Connection '${conn.name}' is not active (status: ${conn.status})`;
          emit({ type: 'tool_call_error', callId, error: errMsg, retryable: false });
          return JSON.stringify({ error: errMsg });
        }

        let token: string;
        try {
          token = await getAccessToken(connectionId, conn.workspace_host);
        } catch (tokenErr: unknown) {
          const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
          emit({ type: 'tool_call_error', callId, error: `Token fetch failed: ${msg}`, retryable: false });
          return JSON.stringify({ error: `Token fetch failed: ${msg}` });
        }

        const sqlResult = await executeDatabricksSQL(
          connectionId,
          conn.workspace_host,
          conn.default_warehouse_id,
          token,
          { statement },
        );

        const cappedRows = sqlResult.rows.slice(0, 1000);
        emit({
          type: 'query_result',
          columns: sqlResult.columns,
          rows: cappedRows,
          sql: statement,
          rowCount: sqlResult.row_count,
          truncated: sqlResult.truncated || sqlResult.rows.length > 1000,
        });

        return JSON.stringify(sqlResult);
      }

      const errMsg = `Tool '${toolSlug}' is not a db_query type — Inspector only supports Databricks SQL tools`;
      emit({ type: 'tool_call_error', callId, error: errMsg, retryable: false });
      return JSON.stringify({ error: errMsg });
    } catch (err: unknown) {
      if (err instanceof ReadOnlyViolationError) {
        const msg = `Read-only violation: ${err.message}`;
        emit({ type: 'tool_call_error', callId, error: msg, retryable: false });
        return JSON.stringify({ error: 'READ_ONLY_VIOLATION', message: err.message });
      }
      if (err instanceof MultiStatementError) {
        const msg = `Multi-statement rejected: ${err.message}`;
        emit({ type: 'tool_call_error', callId, error: msg, retryable: false });
        return JSON.stringify({ error: 'MULTI_STATEMENT', message: err.message });
      }
      if (err instanceof ExternalLinksError) {
        const msg = 'Result too large — add a LIMIT clause';
        emit({ type: 'tool_call_error', callId, error: msg, retryable: true });
        return JSON.stringify({ error: 'RESULT_TOO_LARGE', message: err.message });
      }
      const msg = err instanceof Error ? err.message : 'Tool execution failed';
      emit({ type: 'tool_call_error', callId, error: msg, retryable: true });
      return JSON.stringify({ error: msg });
    }
  }

  if (toolName === 'describe_schema') {
    const { handleDescribeSchema } = await import('@/lib/context/dispatch');
    return handleDescribeSchema(toolInput);
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}
