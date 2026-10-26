/**
 * Job kinds exposed in Jobs UI / launch API vs orchestrator support.
 */

export const LAUNCH_DISABLED_JOB_KINDS = new Set<string>([
  'mapping',
  't3_connected',
  't4_scan',
  't4_entity_propose',
  't4_dim_propose',
  'silo_scan',
  'recompute_entity_tags',
]);

export function isLaunchDisabledKind(kind: string): boolean {
  return LAUNCH_DISABLED_JOB_KINDS.has(kind);
}

export function filterLaunchableKinds(kinds: string[]): string[] {
  return kinds.filter(k => !isLaunchDisabledKind(k));
}
