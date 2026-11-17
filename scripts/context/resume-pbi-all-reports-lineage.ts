#!/usr/bin/env npx tsx
/**
 * Reap a stuck all-reports lineage run and resume from the first incomplete stage.
 *
 *   npx tsx --require ./scripts/context/noserver.cjs scripts/context/resume-pbi-all-reports-lineage.ts
 */

import { launchAllReportsLineage } from '@/lib/powerbi/launch-all-reports-lineage';

async function main() {
  const result = await launchAllReportsLineage({ uiSurface: 'cli.resume-all-reports' });
  if (!result.ok) {
    console.error('Could not resume:', result.error);
    if (result.reaped) {
      console.error('Reaped:', result.reaped);
    }
    process.exit(1);
  }
  console.log('Resumed from:', result.resumeFrom, 'job:', result.jobId, 'worker:', result.taskId ?? 'none');
  console.log('Reaped stale rows:', result.reaped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});