import 'server-only';

import prisma from '@/lib/db';
import { systemPrincipal } from '@/lib/access/principal';
import type { AccessSurface, Level } from '@/lib/access/types';
import { runWarehouseQuery } from '@/lib/access/warehouse';
import type { DaxCompileOptions } from '@/lib/powerbi/dax-sql-compile';
import type { MeasureLogicAnalysis, MeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { expandMeasureSql, type MeasureSqlExpandResult } from '@/lib/powerbi/measure-sql-expand';
import { planRepair } from '@/lib/powerbi/expand-validate-plan';
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
  const v = process.env.PBI_EXPAND_TEST?.trim().toLowerCase();
  if (v === 'explain' || v === 'off') return v;
  return 'execute';
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
      test: { mode: ExpandTestMode | 'no_connection'; value: number | null };
      attempts: ExpandAttempt[];
    }
  | {
      ok: false;
      stage: 'compile' | 'warehouse';
      reason: string;
      sql?: string;
      notes: string[];
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

export async function testSqlOnWarehouse(input: {
  orgId: string;
  connectionId: string;
  sql: string;
  mode: 'execute' | 'explain';
}): Promise<{ ok: true; value: number | null; ms: number } | { ok: false; error: string; ms: number }> {
  const started = Date.now();
  try {
    const result = await runWarehouseQuery({
      connectionId: input.connectionId,
      principal: systemPrincipal('harvest', input.orgId),
      statement: input.mode === 'explain' ? `EXPLAIN ${input.sql}` : input.sql,
      purpose: 'pbi_translate_expand_test',
      // Same runtime values as pbi_parity (runPbiParity), which these types do not list yet.
      level: 'read' as unknown as Level,
      surface: 'harvest' as unknown as AccessSurface,
    });
    const ms = Date.now() - started;
    if (input.mode === 'explain') {
      const plan = result.rows.map((r) => Object.values(r).join(' ')).join('\n');
      const m = plan.match(PLAN_ERROR_RE);
      if (m) return { ok: false, error: plan.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 600), ms };
      return { ok: true, value: null, ms };
    }
    return { ok: true, value: extractSqlScalar(result.rows), ms };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
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
      return { ok: false, stage: 'compile', reason: out.reason, notes: out.notes, attempts };
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

    const aliases = (out.expand_spec.source_aliases ?? {}) as Record<string, string>;
    const fix = planRepair(test.error, aliases, options);
    if (!fix) {
      return {
        ok: false,
        stage: 'warehouse',
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
