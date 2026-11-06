import 'server-only';

import { planForKind, type JobKind } from '@/lib/context/queue';
import { resolveLaunchScopeFilters, stripExcludeSchemasForKind } from '@/lib/estate/job-ui';

/** Rough USD total for a launch request (used for hard harvest budget checks). */
export async function estimateLaunchHarvestUsd(opts: {
  orgId: string;
  kinds: JobKind[];
  sourceIds: string[];
  excludeSchemas: string[];
  includePatterns: string[];
  sequential: boolean;
}): Promise<number> {
  const kindsToPlan =
    opts.sequential && opts.kinds.length > 1 ? [opts.kinds[0]!] : opts.kinds;
  let total = 0;
  for (const kind of kindsToPlan) {
    const stripped = stripExcludeSchemasForKind(kind, opts.excludeSchemas);
    const scope = resolveLaunchScopeFilters(stripped, opts.includePatterns);
    for (const sourceId of opts.sourceIds) {
      const plan = await planForKind(opts.orgId, kind, sourceId, scope);
      total += plan.estimatedCostUsd;
    }
  }
  return total;
}
