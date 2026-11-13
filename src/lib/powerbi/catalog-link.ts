import 'server-only';

import prisma from '@/lib/db';
import { PowerBiApiError } from '@/lib/powerbi/client';
import { pickDatabricksSourceId, resolveCatalogBind } from '@/lib/powerbi/native-sql';

export interface PbiCatalogLinkResult {
  bindings_total: number;
  matched: number;
  unscanned: number;
  ambiguous: number;
  non_uc: number;
  skipped: number;
  run_id: string;
}

export async function runPbiCatalogLink(
  orgId: string,
  sourceId: string,
  opts: { runId: string; modelIds?: string[] },
): Promise<PbiCatalogLinkResult> {
  const source = await prisma.platformContextSource.findFirst({
    where: { id: sourceId, org_id: orgId, connection_kind: 'powerbi', status: 'active' },
  });
  if (!source) {
    throw new PowerBiApiError(`No active Power BI context source ${sourceId}`);
  }

  const databricksSources = await prisma.platformContextSource.findMany({
    where: { org_id: orgId, connection_kind: 'databricks', status: 'active' },
    select: { id: true, connection_ref: true },
  });

  const objects = await prisma.platformContextObject.findMany({
    where: { org_id: orgId, lifecycle: 'active' },
    select: { id: true, full_path: true, source_id: true },
  });

  const pathIndex = new Map<string, { id: string; source_id: string }[]>();
  for (const o of objects) {
    const key = o.full_path.toLowerCase();
    const bucket = pathIndex.get(key) ?? [];
    bucket.push({ id: o.id, source_id: o.source_id });
    pathIndex.set(key, bucket);
  }

  const bindings = await prisma.pbiSourceBinding.findMany({
    where: {
      org_id: orgId,
      partition_kind: 'warehouse_query',
      ...(opts.modelIds?.length
        ? { model: { pbi_model_id: { in: opts.modelIds } } }
        : {}),
    },
    select: {
      id: true,
      native_sql: true,
      connection_host: true,
      bind_status: true,
      source_m_hash: true,
    },
  });

  let matched = 0;
  let unscanned = 0;
  let ambiguous = 0;
  let non_uc = 0;
  for (const b of bindings) {
    const dbSourceId = pickDatabricksSourceId(b.connection_host, databricksSources);
    const resolved = resolveCatalogBind({
      sql: b.native_sql,
      pathIndex,
      databricksSourceId: dbSourceId,
    });

    await prisma.pbiSourceBinding.update({
      where: { id: b.id },
      data: {
        bind_status: resolved.status,
        uc_full_path: resolved.ucPath,
        context_object_id: resolved.contextObjectId,
        databricks_source_id: dbSourceId,
        updated_at: new Date(),
      },
    });

    switch (resolved.status) {
      case 'matched':
        matched += 1;
        break;
      case 'unscanned':
        unscanned += 1;
        break;
      case 'ambiguous':
        ambiguous += 1;
        break;
      case 'non_uc':
        non_uc += 1;
        break;
      default:
        break;
    }
  }

  return {
    bindings_total: bindings.length,
    matched,
    unscanned,
    ambiguous,
    non_uc,
    skipped: 0,
    run_id: opts.runId,
  };
}
