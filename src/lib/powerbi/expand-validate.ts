import 'server-only';

import prisma from '@/lib/db';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';
import type { DaxCompileOptions } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicAnalysis, MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { expandMeasureSql, type MeasureSqlExpandResult } from '@/lib/powerbi/measure-sql-expand';
import { planRepair } from '@/lib/powerbi/expand-validate-plan';
import type { CapabilityGap } from '@/lib/powerbi/rule-registry';
import { extractSqlScalar } from '@/lib/powerbi/parity-compare';

/**
 * Compile → test on the warehouse → repair loop for expanded measures.
 *
 * Repairs are only applied when the warehouse error names the fix (an unresolved source
 * column whose suggested name is the same identifier modulo case/punctuation, or a
 * text-vs-number comparison failure). The PBI oracle is never used to pick SQL — parity
 * stays an independent check.
 */

export type ExpandTestMode = 'execute' | 'explain' | 'off';

export function expandTestMode(): ExpandTestMode {
  // Default: plan check only — parity executes every query against Power BI anyway, and
  // executing in translate doubled warehouse time (Architecture v2, Phase 1).
  const v = process.env.PBI_EXPAND_TEST?.trim().toLowerCase();
  if (v === 'execute' || v === 'off') return v;
  return 'explain';
}

const MAX_ATTEMPTS = 4;

export type ExpandAttempt = {
  options: DaxCompileOptions;
  ok: boolean;
  value?: number | null;
  error?: string;
  ms: number;
  repair?: string;
};

export type ExpandAndTestOutcome =
  | {
      ok: true;
      expanded: MeasureSqlExpandResult;
      /**
       * `deferred`: the explain check ran out of time (Databricks planning is slow on large SQL),
       * so validation moves to parity execution, which has its own, larger budget.
       */
      test: { mode: ExpandTestMode | 'no_connection' | 'deferred'; value: number | null };
      attempts: ExpandAttempt[];
    }
  | {
      ok: false;
      stage: 'compile' | 'warehouse';
      /** Warehouse outcome class: a timeout / transient failure is not a SQL defect. */
      warehouseOutcome?: 'sql_error' | 'timeout' | 'transient';
      reason: string;
      sql?: string;
      notes: string[];
      gap?: CapabilityGap;
      attempts: ExpandAttempt[];
    };

const connectionCache = new Map<string, string | null>();

/** Databricks connection for a PBI model (first matched binding with a Databricks source). */
export async function resolveModelConnectionId(orgId: string, modelId: string): Promise<string | null> {
  const key = `${orgId}:${modelId}`;
  if (connectionCache.has(key)) return connectionCache.get(key)!;
  const binding = await prisma.pbiSourceBinding.findFirst({
    where: {
      org_id: orgId,
      bind_status: 'matched',
      databricks_source_id: { not: null },
      table: { is: { model_id: modelId } },
    },
    select: { databricks_source_id: true },
  });
  let connectionId: string | null = null;
  if (binding?.databricks_source_id) {
    const src = await prisma.platformContextSource.findFirst({
      where: { id: binding.databricks_source_id, org_id: orgId, connection_kind: 'databricks' },
      select: { connection_ref: true },
    });
    connectionId = src?.connection_ref ?? null;
  }
  connectionCache.set(key, connectionId);
  return connectionId;
}

const PLAN_ERROR_RE =
  /(Error occurred during query planning|AnalysisException|\[(?:UNRESOLVED_|DATATYPE_MISMATCH|PARSE_SYNTAX|UNSUPPORTED_)[A-Z_.]*\])/;

/** Explain timeouts defer validation to parity (default on; PBI_DEFER_ON_EXPLAIN_TIMEOUT=0 disables). */
export function deferOnExplainTimeout(): boolean {
  return process.env.PBI_DEFER_ON_EXPLAIN_TIMEOUT !== '0';
}

export async function testSqlOnWarehouse(input: {
  orgId: string;
  connectionId: string;
  sql: string;
  mode: 'execute' | 'explain';
}): Promise<
  | { ok: true; value: number | null; ms: number }
  | { ok: false; error: string; ms: number; kind: 'sql_error' | 'timeout' | 'transient' }
> {
  const out = await runPbiSql({
    orgId: input.orgId,
    connectionId: input.connectionId,
    sql: input.sql,
    mode: input.mode,
    purpose: 'pbi_translate_expand_test',
  });
  if (out.status !== 'ok') return { ok: false, error: out.error, ms: out.ms, kind: out.status };
  return { ok: true, value: input.mode === 'execute' ? extractSqlScalar(out.rows) : null, ms: out.ms };
}

export async function expandAndTestMeasure(input: {
  orgId: string;
  modelId: string;
  measureDax: string;
  measureLogic: MeasureLogicAnalysis;
  catalog: MeasureLogicCatalog;
  mode?: ExpandTestMode;
  anyStrategy?: boolean;
}): Promise<ExpandAndTestOutcome> {
  const mode = input.mode ?? expandTestMode();
  const connectionId = mode === 'off' ? null : await resolveModelConnectionId(input.orgId, input.modelId);
  const attempts: ExpandAttempt[] = [];
  let options: DaxCompileOptions = {};
  let pendingRepair: string | undefined;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const out = expandMeasureSql({
      measureDax: input.measureDax,
      measureLogic: input.measureLogic,
      catalog: input.catalog,
      options,
      anyStrategy: input.anyStrategy,
    });
    if (!out.ok) {
      return { ok: false, stage: 'compile', reason: out.reason, notes: out.notes, gap: out.gap, attempts };
    }
    const expanded: MeasureSqlExpandResult = {
      sql: out.sql,
      pattern: out.pattern,
      expand_spec: out.expand_spec,
    };
    if (mode === 'off' || !connectionId) {
      return {
        ok: true,
        expanded,
        test: { mode: connectionId ? 'off' : 'no_connection', value: null },
        attempts,
      };
    }

    const test = await testSqlOnWarehouse({
      orgId: input.orgId,
      connectionId,
      sql: out.sql,
      mode,
    });
    attempts.push({
      options,
      ok: test.ok,
      ms: test.ms,
      repair: pendingRepair,
      ...(test.ok ? { value: test.value } : { error: test.error.slice(0, 1200) }),
    });
    if (test.ok) return { ok: true, expanded, test: { mode, value: test.value }, attempts };

    if (test.kind === 'timeout' && mode === 'explain' && deferOnExplainTimeout()) {
      // The SQL compiled and Databricks did not reject it — it only ran out of planning time.
      // Paying that planning cost twice wastes the run; parity execution is the real test.
      return { ok: true, expanded, test: { mode: 'deferred', value: null }, attempts };
    }
    if (test.kind !== 'sql_error') {
      // budget exhausted or warehouse/network unavailable: not something a SQL repair can fix
      return {
        ok: false,
        stage: 'warehouse',
        warehouseOutcome: test.kind,
        reason:
          test.kind === 'timeout'
            ? `Warehouse ${mode} exceeded its time budget (${Math.round(test.ms / 1000)} s): ${test.error.slice(0, 300)}`
            : `Warehouse unavailable after retries: ${test.error.slice(0, 300)}`,
        sql: out.sql,
        notes: (out.expand_spec.notes ?? []) as string[],
        attempts,
      };
    }
    const aliases = (out.expand_spec.source_aliases ?? {}) as Record<string, string>;
    const fix = planRepair(test.error, aliases, options);
    if (!fix) {
      return {
        ok: false,
        stage: 'warehouse',
        warehouseOutcome: 'sql_error',
        reason: test.error.slice(0, 600),
        sql: out.sql,
        notes: (out.expand_spec.notes ?? []) as string[],
        attempts,
      };
    }
    options = fix.options;
    pendingRepair = fix.repair;
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    stage: 'warehouse',
    reason: `No passing SQL after ${MAX_ATTEMPTS} attempts: ${last?.error?.slice(0, 400) ?? ''}`,
    notes: [],
    attempts,
  };
}
