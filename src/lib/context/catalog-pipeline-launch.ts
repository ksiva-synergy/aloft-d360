import 'server-only';

import { buildCatalogPipelineLaunchBody } from '@/lib/estate/catalog-pipeline';
import { enqueue, type JobKind } from './queue';
import { launchHarvesterTask } from './launch-harvester';
import { attachWorkerTaskToJob } from './enqueue-and-launch';

/**
 * Enqueue T0 with chain T1→T2 and start one orchestrator worker (Catalog / scheduled flows).
 */
export async function enqueueSequentialSchemaPipeline(
  orgId: string,
  sourceId: string,
  catalog: string,
  schema?: string,
): Promise<{ jobId: string; launched: boolean; includePattern: string }> {
  const body = buildCatalogPipelineLaunchBody(catalog, schema, sourceId);
  const scope: Record<string, unknown> = {
    includePatterns: body.includePatterns,
    chain: ['t1_profile', 't2_semantic'] satisfies JobKind[],
  };
  const job = await enqueue('t0_structural', sourceId, scope, 'on_demand', orgId);
  const { taskId, error } = await launchHarvesterTask(['--kind', 't0_structural']);
  if (taskId) {
    await attachWorkerTaskToJob(job.id, taskId);
  }
  if (error) {
    console.warn(`[catalog-pipeline-launch] worker launch: ${error}`);
  }
  return {
    jobId: job.id,
    launched: Boolean(taskId),
    includePattern: body.includePatterns[0] ?? '',
  };
}
