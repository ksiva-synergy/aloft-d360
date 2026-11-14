#!/usr/bin/env npx tsx
/**
 * LLM investigator for one measure (Architecture v2, Phase 4). Sends a case file under the data
 * policy (metadata + aggregates), runs the probes the LLM asks for, records the diagnosis and acts
 * on the fix (rule → synthesize + prove; compiler → case file; steward / owner → request).
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/powerbi/investigate-llm.ts --model "Vessel Internal Audit" --measure "VIA_Check_Count"
 *   … --no-rules     (do not synthesize registry rules)
 */
import prisma from '@/lib/db';
import { getDefaultOrg } from '@/lib/org';
import { investigateWithLlm } from '@/lib/powerbi/investigator';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgId = getDefaultOrg().id;
  const modelName = arg('--model');
  const measure = arg('--measure');
  if (!modelName || !measure) throw new Error('--model and --measure are required');
  const model = await prisma.pbiModel.findFirst({
    where: { org_id: orgId, name: modelName, lifecycle: 'active' },
    select: { id: true },
  });
  if (!model) throw new Error(`Model not found: ${modelName}`);
  const r = await investigateWithLlm({
    orgId,
    modelId: model.id,
    measure,
    applyRules: !process.argv.includes('--no-rules'),
  });
  console.log(`\n=== ${modelName} / ${measure} ===`);
  console.log(`playbooks: ${r.playbooks.join(', ') || '—'} · rounds ${r.rounds} · probes ${r.probes.length} · $${r.cost_usd.toFixed(4)} · ${Math.round(r.ms / 1000)} s`);
  for (const p of r.probes) console.log(`  probe ${p.status}: ${p.dax} → PBI ${String(p.power_bi)} / SQL ${String(p.sql)}`);
  if (r.reply) {
    console.log(`category: ${r.reply.category} (${Math.round(r.reply.confidence * 100)}%)`);
    console.log(`diagnosis: ${r.reply.diagnosis}`);
    console.log(`fix: ${r.reply.fix.kind} — ${r.reply.fix.summary}`);
  }
  console.log(`outcome: ${JSON.stringify(r.outcome)}`);
  if (r.error) console.log(`error: ${r.error}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
