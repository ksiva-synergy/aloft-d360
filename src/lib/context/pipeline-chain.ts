/**
 * Sequential pipeline launch metadata (Continue → jobs/launch → orchestrator advanceChain).
 */

export function copyPipelineChainMetadata(
  from: Record<string, unknown>,
  onto: Record<string, unknown>,
): void {
  if (Array.isArray(from.chain) && (from.chain as unknown[]).length > 0) {
    onto.chain = from.chain;
  }
  if (typeof from.pipeline_run_id === 'string') {
    onto.pipeline_run_id = from.pipeline_run_id;
  }
  if (typeof from.ui_surface === 'string') {
    onto.ui_surface = from.ui_surface;
  }
}

/** Advance to the next kind after T3 only when usage work ran or scope was empty. */
export function shouldAdvanceChainAfterT3(
  result: { objectsInScope: number; snapshotsWritten: number },
  scopeObj: Record<string, unknown>,
): boolean {
  const chain = Array.isArray(scopeObj.chain) ? scopeObj.chain : [];
  if (chain.length === 0) return false;
  if (result.objectsInScope === 0) return true;
  if (result.snapshotsWritten > 0) return true;
  return false;
}
