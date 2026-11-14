import 'server-only';

import { createHash } from 'node:crypto';

import { systemPrincipal } from '@/lib/access/principal';
import type { AccessSurface, Level } from '@/lib/access/types';
import { runWarehouseQuery } from '@/lib/access/warehouse';

/**
 * The one execution path from the Power BI bridge to Databricks (Architecture v2, L3).
 *
 * - async polling with an explicit time budget per call (no hidden 50 s client cancel)
 * - classified outcomes: ok | sql_error | timeout | transient
 * - bounded retries with backoff on transient failures (503, network)
 * - in-process result cache keyed by statement hash
 */

export type PbiSqlMode = 'explain' | 'execute';

export type PbiSqlOutcome =
  | { status: 'ok'; rows: Record<string, unknown>[]; ms: number; attempts: number; cached: boolean }
  | { status: 'sql_error' | 'timeout' | 'transient'; error: string; ms: number; attempts: number };

export function pbiSqlBudgetMs(mode: PbiSqlMode): number {
  const env = mode === 'explain' ? process.env.PBI_EXEC_EXPLAIN_BUDGET_MS : process.env.PBI_EXEC_EXECUTE_BUDGET_MS;
  const n = Number(env);
  if (Number.isFinite(n) && n > 0) return n;
  return mode === 'explain' ? 120_000 : 600_000;
}

const TRANSIENT_RE =
  /\b(503|502|504|429)\b|TEMPORARILY_UNAVAILABLE|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|Can't reach database server|P1001|P1017|query CANCELED: CANCELED|Async query CANCELED/i;
const TIMEOUT_RE = /timed out after/i;
const PLAN_ERROR_RE =
  /(Error occurred during query planning|AnalysisException|\[(?:UNRESOLVED_|DATATYPE_MISMATCH|PARSE_SYNTAX|UNSUPPORTED_)[A-Z_.]*\])/;

const cache = new Map<string, Record<string, unknown>[]>();
const CACHE_MAX = 2000;

function key(connectionId: string, mode: PbiSqlMode, sql: string): string {
  return createHash('sha256').update(`${connectionId}\0${mode}\0${sql}`).digest('hex');
}

export function classifyWarehouseError(message: string): 'sql_error' | 'timeout' | 'transient' {
  if (TIMEOUT_RE.test(message)) return 'timeout';
  if (TRANSIENT_RE.test(message)) return 'transient';
  return 'sql_error';
}

export async function runPbiSql(input: {
  orgId: string;
  connectionId: string;
  sql: string;
  mode: PbiSqlMode;
  purpose: string;
  budgetMs?: number;
  rowLimit?: number;
  maxAttempts?: number;
  useCache?: boolean;
}): Promise<PbiSqlOutcome> {
  const budgetMs = input.budgetMs ?? pbiSqlBudgetMs(input.mode);
  const maxAttempts = input.maxAttempts ?? 3;
  const statement = input.mode === 'explain' ? `EXPLAIN ${input.sql}` : input.sql;
  const k = key(input.connectionId, input.mode, input.sql);
  if (input.useCache !== false) {
    const hit = cache.get(k);
    if (hit) return { status: 'ok', rows: hit, ms: 0, attempts: 0, cached: true };
  }

  const started = Date.now();
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Hard wall-clock limit (budget + grace) on top of the executor's polling deadline.
      const hardLimitMs = budgetMs + 60_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const hardLimit = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Async query timed out after ${Math.round(hardLimitMs / 1000)}s (hard limit)`)),
          hardLimitMs,
        );
      });
      const result = await Promise.race([runWarehouseQuery({
        connectionId: input.connectionId,
        principal: systemPrincipal('harvest', input.orgId),
        statement,
        purpose: input.purpose,
        // Same runtime values as pbi_parity has always used; not yet in the Level/AccessSurface unions.
        level: 'read' as unknown as Level,
        surface: 'harvest' as unknown as AccessSurface,
        asyncPolling: true,
        pollTimeoutMs: budgetMs,
        rowLimit: input.rowLimit ?? (input.mode === 'explain' ? 50 : 100),
      }), hardLimit]).finally(() => clearTimeout(timer));
      if (input.mode === 'explain') {
        const plan = result.rows.map((r) => Object.values(r).join(' ')).join('\n');
        const m = plan.match(PLAN_ERROR_RE);
        if (m) {
          return {
            status: 'sql_error',
            error: plan.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 600),
            ms: Date.now() - started,
            attempts: attempt,
          };
        }
      }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(k, result.rows);
      return { status: 'ok', rows: result.rows, ms: Date.now() - started, attempts: attempt, cached: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const kind = classifyWarehouseError(lastError);
      if (kind !== 'transient' || attempt >= maxAttempts) {
        return { status: kind, error: lastError.slice(0, 1500), ms: Date.now() - started, attempts: attempt };
      }
      await new Promise((r) => setTimeout(r, attempt * 10_000));
    }
  }
  return { status: 'transient', error: lastError.slice(0, 1500), ms: Date.now() - started, attempts: maxAttempts };
}
