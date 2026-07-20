/**
 * Vitest global setup (Guided Phase 4 — DOM harness entry condition).
 *
 * Registers @testing-library/jest-dom's custom matchers (`toBeInTheDocument`,
 * `toHaveAttribute`, …) on Vitest's `expect`. This is a pure `expect.extend`
 * side-effect at import time — it references the DOM only when a matcher is
 * actually invoked — so it is harmless under the global `node` environment and
 * only does real work in the `jsdom` render tests that use these matchers.
 *
 * @testing-library/react auto-registers its `afterEach(cleanup)` when Vitest
 * globals are enabled (they are), so no explicit cleanup wiring is needed here.
 */
import '@testing-library/jest-dom/vitest';
