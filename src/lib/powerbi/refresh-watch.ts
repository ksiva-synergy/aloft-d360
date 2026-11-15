import 'server-only';

/**
 * Verify right after Power BI refreshes. Power BI only reflects the warehouse just after its
 * dataset refresh, so recreated measures are compared then — not at an arbitrary time. This
 * finds models whose latest completed refresh is newer than the one last verified; the caller
 * (orchestrator `pbi_refresh_watch`) queues Power BI values → Compare → Publish for them, which
 * also re-checks every measure that was "stale" (see freshness.ts).
 */

import prisma from '@/lib/db';
import { getLatestDatasetRefreshEnd } from '@/lib/powerbi/client';

export type RefreshedModel = { id: string; pbi_model_id: string; name: string; refreshed_at: string; last_verified: string | null };

type FreshnessProps = { freshness?: { verified_refresh_at?: string } };

/** Models with recreated SQL whose dataset refreshed since their last verification. */
export async function findModelsRefreshedSinceVerification(
  orgId: string,
  opts: { modelIds?: string[] } = {},
): Promise<{ due: RefreshedModel[]; checked: number; errors: string[] }> {
  const models = await prisma.pbiModel.findMany({
    where: {
      org_id: orgId,
      lifecycle: 'active',
      translations: { some: { sql_text: { not: null } } },
      ...(opts.modelIds?.length ? { pbi_model_id: { in: opts.modelIds } } : {}),
    },
    select: { id: true, pbi_model_id: true, name: true, props: true, workspace: { select: { pbi_workspace_id: true } } },
  });
  const due: RefreshedModel[] = [];
  const errors: string[] = [];
  for (const m of models) {
    try {
      const refreshed = await getLatestDatasetRefreshEnd(m.workspace.pbi_workspace_id, m.pbi_model_id);
      if (!refreshed) continue;
      const marker = (m.props as FreshnessProps | null)?.freshness?.verified_refresh_at ?? null;
      // already compared after this refresh (by any run) → nothing to do
      const lastCompared = await latestParityCheck(m.id);
      const last = [marker, lastCompared].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
      if (!last || refreshed.getTime() > Date.parse(last)) {
        due.push({ id: m.id, pbi_model_id: m.pbi_model_id, name: m.name, refreshed_at: refreshed.toISOString(), last_verified: last });
      }
    } catch (e) {
      errors.push(`${m.name}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return { due, checked: models.length, errors };
}

/** Record that verification was queued for this refresh (so the next watch does not repeat it). */
export async function markRefreshVerificationQueued(models: RefreshedModel[]): Promise<void> {
  for (const m of models) {
    await prisma.$executeRaw`
      UPDATE pbi_models
      SET props = jsonb_set(COALESCE(props, '{}'::jsonb), '{freshness}',
            COALESCE(props->'freshness', '{}'::jsonb) || jsonb_build_object('verified_refresh_at', ${m.refreshed_at}::text, 'queued_at', ${new Date().toISOString()}::text)),
          updated_at = NOW()
      WHERE id = ${m.id}::uuid
    `;
  }
}

/** Latest time any measure of the model was compared with Power BI. */
async function latestParityCheck(modelId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ at: string | null }[]>`
    SELECT max(props->'parity'->>'checked_at') AS at FROM pbi_translations WHERE model_id = ${modelId}::uuid
  `;
  return rows[0]?.at ?? null;
}
