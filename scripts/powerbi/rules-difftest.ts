#!/usr/bin/env npx tsx
/**
 * Translation rule registry tooling.
 *
 *   # prove the compiler's built-in DAX functions against Power BI (differential test)
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/rules-difftest.ts --builtins [WEEKNUM,TRIM]
 *
 *   # LLM-synthesize + verify rules for named functions (NAME:arity)
 *   … rules-difftest.ts --synthesize REPT:2,SIGN:1
 *
 *   # synthesize rules for every DAX function gap found by compiling all harvested measures
 *   … rules-difftest.ts --gaps
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { compileMeasureToSql } from '@/lib/powerbi/dax-sql-compile';
import { loadMeasureLogicCatalog } from '@/lib/powerbi/measure-logic-analyze';
import { BUILTIN_FUNCTION_SPECS } from '@/lib/powerbi/rule-builtin-specs';
import { resolveDiffTestTarget, runDifferentialTest } from '@/lib/powerbi/rule-difftest-run';
import { loadRuleSet } from '@/lib/powerbi/rule-store';
import { synthesizeDaxRule } from '@/lib/powerbi/rule-synthesize';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

async function builtins(orgId: string, only: string[] | null) {
  const target = await resolveDiffTestTarget(orgId);
  const rules = await loadRuleSet(orgId);
  let failed = 0;
  for (const spec of BUILTIN_FUNCTION_SPECS) {
    if (only && !only.includes(spec.name)) continue;
    const r = await runDifferentialTest({ target, spec, rules });
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${spec.name.padEnd(16)} compared=${r.compared} mismatches=${r.mismatches.length}${r.error ? ` error=${r.error}` : ''}`);
    for (const m of r.mismatches.slice(0, 5)) {
      console.log(`       in=${JSON.stringify(m.inputs)} lit=${JSON.stringify(m.literals)} pbi=${JSON.stringify(m.powerBi)} sql=${JSON.stringify(m.sql)}`);
    }
  }
  console.log(`\n${failed} built-in function(s) differ from Power BI`);
}

async function synthesize(orgId: string, targets: { name: string; arity: number; examples: string[] }[]) {
  const target = await resolveDiffTestTarget(orgId);
  const existing = await loadRuleSet(orgId);
  for (const t of targets) {
    const out = await synthesizeDaxRule({
      orgId,
      name: t.name,
      arity: t.arity,
      usageExamples: t.examples,
      target,
      existingRules: existing,
    });
    console.log(
      `${out.status.toUpperCase().padEnd(9)} ${out.name}/${out.arity} attempts=${out.attempts} template=${out.sqlTemplate ?? '-'}${out.error ? ` last_error=${out.error}` : ''}`,
    );
    if (out.status === 'rejected') {
      for (const m of out.lastResult?.mismatches.slice(0, 5) ?? []) {
        console.log(`       in=${JSON.stringify(m.inputs)} lit=${JSON.stringify(m.literals)} pbi=${JSON.stringify(m.powerBi)} sql=${JSON.stringify(m.sql)}`);
      }
    }
  }
}

async function gapTargets(orgId: string) {
  const models = await prisma.pbiModel.findMany({
    where: { org_id: orgId, lifecycle: 'active', measures: { some: {} } },
    select: { id: true },
  });
  const gaps = new Map<string, { name: string; arity: number; examples: string[]; count: number }>();
  const other = new Map<string, number>();
  for (const m of models) {
    const catalog = await loadMeasureLogicCatalog(orgId, m.id);
    const measures = await prisma.pbiMeasure.findMany({ where: { model_id: m.id }, select: { dax: true } });
    for (const ms of measures) {
      const out = compileMeasureToSql({ measureDax: ms.dax, catalog });
      if (out.ok || !out.gap) continue;
      if (out.gap.kind !== 'dax_fn') {
        const k = `${out.gap.kind}:${out.gap.name}`;
        other.set(k, (other.get(k) ?? 0) + 1);
        continue;
      }
      const key = `${out.gap.name}/${out.gap.arity}`;
      const g = gaps.get(key) ?? { name: out.gap.name, arity: out.gap.arity ?? 0, examples: [], count: 0 };
      g.count += 1;
      if (g.examples.length < 5) g.examples.push(ms.dax.replace(/\s+/g, ' ').slice(0, 300));
      gaps.set(key, g);
    }
  }
  console.log('DAX function gaps:', [...gaps.values()].map((g) => `${g.name}/${g.arity}×${g.count}`).join(', ') || 'none');
  console.log('Other structured gaps (not synthesizable by function rules yet):', JSON.stringify(Object.fromEntries(other)));
  return [...gaps.values()].sort((a, b) => b.count - a.count);
}

async function main() {
  const orgId = getDefaultOrg().id;
  const b = arg('--builtins');
  if (b !== undefined) {
    await builtins(orgId, b ? b.split(',').map((s) => s.trim().toUpperCase()) : null);
    return;
  }
  const s = arg('--synthesize');
  if (s) {
    await synthesize(
      orgId,
      s.split(',').map((x) => {
        const [name, arity] = x.split(':');
        return { name: name!.trim(), arity: Number(arity ?? 1), examples: [] };
      }),
    );
    return;
  }
  if (arg('--gaps') !== undefined) {
    const targets = await gapTargets(orgId);
    if (targets.length) await synthesize(orgId, targets);
    return;
  }
  console.log('usage: --builtins [A,B] | --synthesize NAME:arity,… | --gaps');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
