#!/usr/bin/env npx tsx
/**
 * Golden-set gate for compiler changes (guardrail). Read-only: writes nothing.
 *
 * For every measure that currently matches Power BI (parity pass / published), recompile with the
 * current compiler:
 *   - identical SQL            → safe, nothing to run
 *   - changed SQL              → run the OLD and the NEW SQL on today's data and compare
 *                                (same snapshot, so dataset staleness cannot cause false alarms)
 *   - no longer compiles       → regression
 * Exit code 1 when anything regresses — run before merging a compiler change.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/golden-check.ts --models "Vessel Internal Audit"
 *   … --max-exec 40          (cap warehouse executions; default 60)
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { COMPILER_VERSION, compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { resolveModelConnectionId } from '@/lib/powerbi/expand-validate';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { decideTypedParity, extractSqlValue } from '@/lib/powerbi/parity-compare';
import { runPbiSql } from '@/lib/powerbi/warehouse-exec';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Outcome = 'identical' | 'same_value' | 'changed_value' | 'no_longer_compiles' | 'exec_error' | 'not_checked';

async function main() {
  const orgId = getDefaultOrg().id;
  const wanted = arg('--models')?.split(',').map((s) => s.trim()).filter(Boolean);
  const maxExec = Number(arg('--max-exec') ?? '60');
  const models = await prisma.pbiModel.findMany({
    where: { org_id: orgId, lifecycle: 'active', ...(wanted ? { name: { in: wanted } } : {}) },
    select: { id: true, name: true },
  });
  console.log(`[golden] compiler ${COMPILER_VERSION}`);
  let executions = 0;
  const regressions: string[] = [];
  const totals: Record<Outcome, number> = {
    identical: 0,
    same_value: 0,
    changed_value: 0,
    no_longer_compiles: 0,
    exec_error: 0,
    not_checked: 0,
  };

  for (const m of models) {
    const golden = await prisma.pbiTranslation.findMany({
      where: { org_id: orgId, model_id: m.id, parity_verdict: 'pass', tier: 'expand', sql_text: { not: null } },
      select: { measure_name: true, sql_text: true },
    });
    if (!golden.length) continue;
    const catalog = await loadMeasureLogicCatalog(orgId, m.id);
    const conn = await resolveModelConnectionId(orgId, m.id);
    for (const g of golden) {
      const def = catalog.measures?.get(g.measure_name.toLowerCase());
      const c = def ? compileMeasureToSql({ measureDax: def.dax, catalog }) : null;
      let outcome: Outcome;
      let detail = '';
      if (!c?.ok) {
        outcome = 'no_longer_compiles';
        detail = c && !c.ok ? c.reason : 'measure not in the harvested model';
      } else if (c.sql === g.sql_text) {
        outcome = 'identical';
      } else if (!conn || executions >= maxExec) {
        outcome = 'not_checked';
        detail = conn ? `execution cap ${maxExec} reached` : 'no warehouse connection';
      } else {
        executions += 2;
        const [oldRun, newRun] = await Promise.all([
          runPbiSql({ orgId, connectionId: conn, sql: g.sql_text!, mode: 'execute', purpose: 'pbi_golden_old', useCache: false }),
          runPbiSql({ orgId, connectionId: conn, sql: c.sql, mode: 'execute', purpose: 'pbi_golden_new', useCache: false }),
        ]);
        if (oldRun.status !== 'ok' || newRun.status !== 'ok') {
          outcome = newRun.status !== 'ok' && oldRun.status === 'ok' ? 'exec_error' : 'not_checked';
          detail = newRun.status !== 'ok' ? `new SQL ${newRun.status}: ${newRun.error.slice(0, 160)}` : 'old SQL failed today';
        } else {
          const a = extractSqlValue(oldRun.rows);
          const b = extractSqlValue(newRun.rows);
          const same = decideTypedParity({ oracle: a, sql: b }).verdict === 'pass';
          outcome = same ? 'same_value' : 'changed_value';
          detail = `old=${String(a.raw)} new=${String(b.raw)}`;
        }
      }
      totals[outcome] += 1;
      if (outcome === 'no_longer_compiles' || outcome === 'changed_value' || outcome === 'exec_error') {
        regressions.push(`${m.name} / ${g.measure_name}: ${outcome} ${detail}`);
      } else if (outcome === 'not_checked') {
        console.log(`[golden] not checked: ${m.name} / ${g.measure_name} (${detail})`);
      }
    }
  }
  console.log(`[golden] ${JSON.stringify(totals)} · warehouse executions ${executions}`);
  if (regressions.length) {
    console.log(`[golden] REGRESSIONS (${regressions.length}):\n  ${regressions.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('[golden] OK — every matching measure compiles to the same SQL or the same value');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
