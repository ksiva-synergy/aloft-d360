import 'server-only';

import prisma from '@/lib/db';
import { enqueueSequentialSchemaPipeline } from './catalog-pipeline-launch';

export interface RunScheduledHarvestOpts {
  orgId: string;
  sourceId: string;
  catalog?: string;
  schema?: string;
  /** Max distinct schemas to start pipelines for in one request */
  maxSchemas?: number;
}

export interface RunScheduledHarvestResult {
  schemasStarted: number;
  jobs: { catalog: string; schema: string; jobId: string; launched: boolean }[];
  pathsMarkedQueued: number;
}

/**
 * Find estate rows with harvest_state = scheduled, group by catalog.schema,
 * launch sequential T0→T1→T2 per schema (Limit glob), mark rows queued.
 */
export async function runScheduledEstateHarvest(
  opts: RunScheduledHarvestOpts,
): Promise<RunScheduledHarvestResult> {
  const maxSchemas = opts.maxSchemas ?? 5;
  const conditions: string[] = [
    'org_id = $1',
    'source_id = $2',
    "lifecycle = 'active'",
    "harvest_state = 'scheduled'",
  ];
  const params: unknown[] = [opts.orgId, opts.sourceId];
  let paramIdx = 3;

  if (opts.catalog) {
    conditions.push(`catalog_name = $${paramIdx}`);
    params.push(opts.catalog);
    paramIdx++;
  }
  if (opts.schema) {
    conditions.push(`schema_name = $${paramIdx}`);
    params.push(opts.schema);
    paramIdx++;
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{ catalog_name: string; schema_name: string; full_path: string }>
  >(
    `SELECT catalog_name, schema_name, full_path
     FROM platform_estate_objects
     WHERE ${conditions.join(' AND ')}
     ORDER BY catalog_name, schema_name, full_path
     LIMIT 5000`,
    ...params,
  );

  const schemaKeys = new Map<string, { catalog: string; schema: string; paths: string[] }>();
  for (const r of rows) {
    const key = `${r.catalog_name}.${r.schema_name}`;
    let bucket = schemaKeys.get(key);
    if (!bucket) {
      bucket = { catalog: r.catalog_name, schema: r.schema_name, paths: [] };
      schemaKeys.set(key, bucket);
    }
    bucket.paths.push(r.full_path);
  }

  const jobs: RunScheduledHarvestResult['jobs'] = [];
  let pathsMarkedQueued = 0;
  const started = Array.from(schemaKeys.values()).slice(0, maxSchemas);

  for (const { catalog, schema, paths } of started) {
    const launch = await enqueueSequentialSchemaPipeline(opts.orgId, opts.sourceId, catalog, schema);
    jobs.push({ catalog, schema, jobId: launch.jobId, launched: launch.launched });

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE platform_estate_objects
       SET harvest_state = 'queued'
       WHERE org_id = $1 AND source_id = $2 AND lifecycle = 'active'
         AND catalog_name = $3 AND schema_name = $4
         AND full_path = ANY($5::text[])
         AND harvest_state = 'scheduled'`,
      opts.orgId,
      opts.sourceId,
      catalog,
      schema,
      paths,
    );
    pathsMarkedQueued += Number(updated);
  }

  return {
    schemasStarted: jobs.length,
    jobs,
    pathsMarkedQueued,
  };
}
