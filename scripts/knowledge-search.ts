/**
 * knowledge-search.ts — ask a question of one knowledge base and print the cited passages (Phase 0 check).
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/knowledge-search.ts --kb "QHSE pilot" --q "What do we do after an enclosed space near-miss?"
 */
import { PrismaClient } from '@prisma/client';
import { getDefaultOrg } from '../src/lib/org';
import { prismaKnowledgeRepo } from '../src/lib/knowledge/repo';
import { embedQuestion } from '../src/lib/knowledge/embed';
import { searchKnowledge } from '../src/lib/knowledge/search';

const prisma = new PrismaClient();
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const kb = arg('--kb');
  const question = arg('--q');
  if (!kb || !question) throw new Error('Usage: knowledge-search.ts --kb "<knowledge base name>" --q "<question>" [--limit 8]');
  const orgId = getDefaultOrg().id;
  const source = await prisma.knowledge_sources.findFirst({ where: { org_id: orgId, name: kb } });
  if (!source) throw new Error(`No knowledge base named "${kb}"`);
  const t0 = Date.now();
  const hits = await searchKnowledge(
    { orgId, userId: null, surface: 'script', sourceIds: [source.id], question, limit: Number(arg('--limit') ?? 8) },
    { repo: prismaKnowledgeRepo, embedQuestion },
  );
  console.log(`${hits.length} result(s) in ${Date.now() - t0} ms for: ${question}\n`);
  hits.forEach((h, i) => {
    console.log(`${i + 1}. ${h.document ?? '(no document)'}${h.version ? ` v${h.version}` : ''}${h.section ? ` › ${h.section}` : ''}${h.page ? ` · page ${h.page}` : ''}  [${h.matchedBy}, ${h.score}]`);
    console.log(`   ${h.text.replace(/\s+/g, ' ').slice(0, 300)}${h.text.length > 300 ? '…' : ''}\n`);
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
