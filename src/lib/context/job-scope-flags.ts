/** Optional runner flags stored on `platform_context_jobs.scope` (Jobs launch / chain). */

export interface JobScopeRunnerFlags {
  forceReprofile?: boolean;
  forceReEnrich?: boolean;
  forceFullScan?: boolean;
  /** Explicit opt-in to run T1/T2/embed/T3 on whole source without Focus Limit. */
  allowFullSourceLaunch?: boolean;
}

export function readJobScopeRunnerFlags(scope: Record<string, unknown>): JobScopeRunnerFlags {
  return {
    forceReprofile: scope.forceReprofile === true,
    forceReEnrich: scope.forceReEnrich === true,
    forceFullScan: scope.forceFullScan === true,
    allowFullSourceLaunch: scope.allowFullSourceLaunch === true,
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
  if (flags.allowFullSourceLaunch) next.allowFullSourceLaunch = true;
  return next;
}

export function copyRunnerFlagsToChildScope(
  parentScope: Record<string, unknown>,
  childScope: Record<string, unknown>,
): Record<string, unknown> {
  const flags = readJobScopeRunnerFlags(parentScope);
  return mergeJobScopeRunnerFlags(childScope, flags);
}
