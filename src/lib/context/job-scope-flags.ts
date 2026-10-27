/** Optional runner flags stored on `platform_context_jobs.scope` (Jobs launch / chain). */

export interface JobScopeRunnerFlags {
  forceReprofile?: boolean;
  forceReEnrich?: boolean;
  forceFullScan?: boolean;
}

export function readJobScopeRunnerFlags(scope: Record<string, unknown>): JobScopeRunnerFlags {
  return {
    forceReprofile: scope.forceReprofile === true,
    forceReEnrich: scope.forceReEnrich === true,
    forceFullScan: scope.forceFullScan === true,
  };
}

export function mergeJobScopeRunnerFlags(
  scope: Record<string, unknown>,
  flags: JobScopeRunnerFlags,
): Record<string, unknown> {
  const next = { ...scope };
  if (flags.forceReprofile) next.forceReprofile = true;
  if (flags.forceReEnrich) next.forceReEnrich = true;
  if (flags.forceFullScan) next.forceFullScan = true;
  return next;
}

export function copyRunnerFlagsToChildScope(
  parentScope: Record<string, unknown>,
  childScope: Record<string, unknown>,
): Record<string, unknown> {
  const flags = readJobScopeRunnerFlags(parentScope);
  return mergeJobScopeRunnerFlags(childScope, flags);
}
