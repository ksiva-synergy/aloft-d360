import 'server-only';

import os from 'node:os';
import { prismaKnowledgeRepo } from './repo';
import { prismaJobQueue } from './job-queue';
import { runJobs } from './jobs';
import { indexDocument } from './index-document';
import { embedForKnowledge } from './embed';
import { ocrConfigFromEnv } from './ocr';
import { readStoredBytes } from './store';

// Phase 1 runs knowledge jobs inside the ALOFT server (a long-running Node process on ECS): an upload
// queues a job and kicks the runner, which keeps draining the queue in the background after the
// request has returned. Only one runner per process at a time; jobs live in Postgres, so a restart
// loses nothing (the next kick — any upload or a knowledge-base page load — picks them up, and a job
// left running by a dead process is reclaimed after 15 minutes). A dedicated worker can take this over
// later, shared with the Automate run engine.

let running: Promise<void> | null = null;
let again = false;

export function kickKnowledgeJobs(): void {
  if (running) {
    again = true; // new work arrived while draining: go round once more
    return;
  }
  running = (async () => {
    do {
      again = false;
      await runJobs(
        prismaJobQueue,
        {
          index_document: async (job) => {
            if (!job.document_id) throw new Error('index_document job without a document');
            await indexDocument(job.document_id, { repo: prismaKnowledgeRepo, readBytes: readStoredBytes, embed: embedForKnowledge, ocr: ocrConfigFromEnv() });
          },
        },
        {
          workerId: `${os.hostname()}-${process.pid}`,
          onEvent: ({ job, result, error }) => {
            if (result !== 'done') console.warn(`[knowledge] job ${job.id} (${job.kind}) ${result}: ${error ?? ''}`);
          },
        },
      );
    } while (again);
  })()
    .catch((e: unknown) => console.error('[knowledge] job runner stopped:', e instanceof Error ? e.message : e))
    .finally(() => {
      running = null;
    });
}
