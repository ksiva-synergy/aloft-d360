/**
 * knowledge-index.ts — add local files to a knowledge base and index them (Phase 0 check).
 *
 * Creates the knowledge base (organisation level) if it does not exist, adds each file as a new
 * document version (skipped when the same file is already indexed), queues an index job per file and
 * runs the jobs here: read (pdf-inspector, Mistral OCR for scanned pages, Word, Excel, PowerPoint,
 * text), split by structure, embed with Titan only, store. Needs migration 20261028_knowledge_phase0.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/knowledge-index.ts --kb "QHSE pilot" ./SMS.pdf ./circular-12.docx
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { getDefaultOrg } from '../src/lib/org';
import { prismaKnowledgeRepo } from '../src/lib/knowledge/repo';
import { prismaJobQueue, enqueueIndexJob } from '../src/lib/knowledge/job-queue';
import { runJobs } from '../src/lib/knowledge/jobs';
import { indexDocument, type IndexReport } from '../src/lib/knowledge/index-document';
import { embedForKnowledge } from '../src/lib/knowledge/embed';
import { ocrConfigFromEnv } from '../src/lib/knowledge/ocr';
import { readStoredBytes } from '../src/lib/knowledge/store';

process.env.KNOWLEDGE_ALLOW_LOCAL_FILES = '1';
const prisma = new PrismaClient();

function args() {
  const a = process.argv.slice(2);
  const kbAt = a.indexOf('--kb');
  if (kbAt < 0 || !a[kbAt + 1]) throw new Error('Usage: knowledge-index.ts --kb "<knowledge base name>" <file> [file …]');
  const kb = a[kbAt + 1]!;
  const files = a.filter((_, i) => i !== kbAt && i !== kbAt + 1);
  if (!files.length) throw new Error('Give at least one file to index');
  return { kb, files };
}

async function main() {
  const { kb, files } = args();
  const orgId = getDefaultOrg().id;
  const by = `script:${process.env.USERNAME ?? process.env.USER ?? 'local'}`;
  const source =
    (await prisma.knowledge_sources.findFirst({ where: { org_id: orgId, name: kb } })) ??
    (await prisma.knowledge_sources.create({ data: { org_id: orgId, name: kb, type: 'FILE', scope: 'org', status: 'PENDING', description: 'Created by scripts/knowledge-index.ts' } }));
  console.log(`Knowledge base "${source.name}" (${source.id})`);

  for (const file of files) {
    const abs = path.resolve(file);
    const bytes = await readFile(abs);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const name = path.basename(abs);
    const current = await prisma.knowledge_documents.findFirst({ where: { source_id: source.id, path: name, status: { not: 'superseded' } }, orderBy: { version: 'desc' } });
    if (current?.content_hash === hash && current.status === 'indexed') {
      console.log(`  ${name}: unchanged, already indexed (version ${current.version})`);
      continue;
    }
    // A new version takes the path; the previous one is marked superseded once this one is indexed.
    if (current) await prisma.knowledge_documents.update({ where: { id: current.id }, data: { status: 'superseded' } });
    const doc = await prisma.knowledge_documents.create({
      data: {
        source_id: source.id,
        org_id: orgId,
        kind: 'file',
        origin: 'upload',
        name,
        path: name,
        storage_ref: pathToFileURL(abs).href,
        size_bytes: (await stat(abs)).size,
        content_hash: hash,
        version: (current?.version ?? 0) + 1,
        created_by: by,
      },
    });
    await enqueueIndexJob({ orgId, sourceId: source.id, documentId: doc.id });
    console.log(`  ${name}: queued as version ${doc.version}`);
  }

  const reports: IndexReport[] = [];
  const ocr = ocrConfigFromEnv();
  const started = Date.now();
  const totals = await runJobs(
    prismaJobQueue,
    {
      index_document: async (job) => {
        reports.push(await indexDocument(job.document_id!, { repo: prismaKnowledgeRepo, readBytes: readStoredBytes, embed: embedForKnowledge, ocr }));
      },
    },
    {
      workerId: `script-${process.pid}`,
      onEvent: ({ job, result, error }) => {
        if (result !== 'done') console.log(`  job ${job.id}: ${result}${error ? ` — ${error}` : ''}`);
      },
    },
  );
  for (const r of reports) {
    console.log(
      `  ${r.status.toUpperCase()} ${r.documentId}: ${r.chunks} pieces (${r.embedded} embedded, ${r.reused} reused), pages ${r.pages ?? '-'}, OCR pages ${r.ocrPages}` +
        `${r.failedPages.length ? `, failed pages ${r.failedPages.join(',')}` : ''}${r.warnings.length ? `\n    warnings: ${r.warnings.join(' | ')}` : ''}${r.error ? `\n    error: ${r.error}` : ''}`,
    );
  }
  console.log(`Jobs: ${totals.done} done, ${totals.retrying} will retry, ${totals.failed} failed, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
