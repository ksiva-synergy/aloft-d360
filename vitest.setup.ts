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
import { vi } from 'vitest';
import React from 'react';

/**
 * Global test double for the canvas-only ECharts renderer. jsdom has no 2D
 * canvas context, so real `echarts-for-react` cannot mount under the render
 * tests. This stub renders a lightweight <div> that echoes the option (so a test
 * MAY assert on it) without touching canvas. It changes no component behaviour or
 * test assertion — it only makes the SamplePreviewChart chart-mount inert in
 * jsdom. Production and the SSR-render path use the real renderer untouched.
 */
vi.mock('echarts-for-react/lib/core', () => ({
  __esModule: true,
  default: (props: { option?: unknown; theme?: unknown }) =>
    React.createElement('div', {
      'data-testid': 'echarts-mock',
      'data-echarts-theme': String(props.theme ?? ''),
      'data-echarts-option': JSON.stringify(props.option ?? {}),
    }),
}));
