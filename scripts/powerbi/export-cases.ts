#!/usr/bin/env npx tsx
/**
 * Export open investigator case files (compiler changes the pipeline cannot make on its own) for a
 * coding agent, and close cases whose measure now matches Power BI. Case files contain metadata and
 * aggregates only (data policy). Default output: .cases/powerbi/ (git-ignored).
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/export-cases.ts
 *   … --out <dir>   --models "Vessel Internal Audit"
 *
 * Workflow for the agent: .claude/skills/pbi-recreation/SKILL.md → "Working a case file".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

async function main() {
  const orgId = getDefaultOrg().id;
  const out = arg('--out') ?? join(process.cwd(), '.cases', 'powerbi');
  const wanted = arg('--models')?.split(',').map((s) => s.trim()).filter(Boolean);
  const rows = await prisma.pbiTranslation.findMany({
    where: { org_id: orgId, ...(wanted ? { model: { name: { in: wanted } } } : {}) },
    select: { id: true, measure_name: true, parity_verdict: true, props: true, model: { select: { name: true } } },
  });
  mkdirSync(out, { recursive: true });
  const index: { file: string; model: string; measure: string; category: string; confidence: number; created_at: string }[] = [];
  let resolved = 0;
  for (const r of rows) {
    const props = (r.props ?? {}) as Record<string, unknown>;
    const cf = props.case_file as Record<string, unknown> | undefined;
    if (!cf || cf.status !== 'open') continue;
    if (r.parity_verdict === 'pass') {
      // fixed since the case was opened
      await prisma.pbiTranslation.update({
        where: { id: r.id },
        data: { props: { ...props, case_file: { ...cf, status: 'resolved', resolved_at: new Date().toISOString() } } as object },
      });
      resolved += 1;
      continue;
    }
    const file = `${slug(r.model.name)}__${slug(r.measure_name)}.json`;
    writeFileSync(join(out, file), `${JSON.stringify(cf, null, 2)}\n`);
    index.push({
      file,
      model: r.model.name,
      measure: r.measure_name,
      category: String(cf.category ?? ''),
      confidence: Number(cf.confidence ?? 0),
      created_at: String(cf.created_at ?? ''),
    });
  }
  index.sort((a, b) => b.confidence - a.confidence);
  writeFileSync(join(out, 'index.json'), `${JSON.stringify({ exported_at: new Date().toISOString(), cases: index }, null, 2)}\n`);
  console.log(`[cases] ${index.length} open case(s) → ${out}; ${resolved} resolved since opened`);
  for (const c of index) console.log(`  ${c.category} (${Math.round(c.confidence * 100)}%) ${c.model} / ${c.measure}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
