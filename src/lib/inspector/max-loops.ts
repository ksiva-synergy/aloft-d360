/** Default agentic tool loops per Inspector chat turn (one user message). */
const DEFAULT_INSPECTOR_MAX_LOOPS = 15;

const MIN_LOOPS = 1;
const MAX_LOOPS = 32;

/**
 * Max Bedrock/agent loops per Inspector turn. Override with `INSPECTOR_MAX_LOOPS` (1–32).
 */
export function getInspectorMaxLoops(): number {
  const raw = process.env.INSPECTOR_MAX_LOOPS?.trim();
  if (!raw) return DEFAULT_INSPECTOR_MAX_LOOPS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_INSPECTOR_MAX_LOOPS;
  return Math.min(MAX_LOOPS, Math.max(MIN_LOOPS, n));
}
