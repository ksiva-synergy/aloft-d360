// @vitest-environment jsdom
/**
 * Step 2 verification (guided-viz redesign): the inspector-dark / inspector-light
 * ECharts themes are REGISTERED on the shared echarts core instance and a real
 * chart PICKS THEM UP — i.e. selecting the theme by name applies the Okabe-Ito
 * palette from the shared token module. Uses the SVG renderer (registered in
 * echartsCore.ts) so it runs in jsdom without a canvas.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import echarts from '@/lib/studio/echartsCore';
import { inspectorDarkTheme, inspectorLightTheme } from '@/lib/studio/inspectorEchartsTheme';
import { CATEGORICAL } from '@/lib/dashboards/inspector-viz-tokens';

// jsdom has no 2D canvas context, so zrender's text measurement throws (noise,
// not a failure). Stub a minimal measureText — the palette assertion below does
// not depend on real glyph metrics.
beforeAll(() => {
  const proto = globalThis.HTMLCanvasElement?.prototype;
  if (proto) {
    proto.getContext = (() => ({ measureText: () => ({ width: 0 }) })) as never;
  }
});

/** Init a themed SVG chart, set a 2-series bar option, read back the merged option. */
function appliedColorFor(theme: 'inspector-dark' | 'inspector-light'): unknown[] {
  const el = document.createElement('div');
  // ECharts needs a measured box; jsdom reports 0 so pin an explicit size.
  Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  const chart = echarts.init(el, theme, { renderer: 'svg' });
  chart.setOption({
    xAxis: { type: 'category', data: ['a', 'b'] },
    yAxis: { type: 'value' },
    series: [
      { type: 'bar', data: [1, 2] },
      { type: 'bar', data: [3, 4] },
    ],
  });
  const opt = chart.getOption() as { color?: unknown[] };
  chart.dispose();
  return opt.color ?? [];
}

describe('inspector ECharts themes', () => {
  it('theme objects carry the capped Okabe-Ito palette (same colours everywhere)', () => {
    expect(inspectorDarkTheme.color).toEqual([...CATEGORICAL]);
    expect(inspectorLightTheme.color).toEqual([...CATEGORICAL]);
  });

  it('a chart selecting "inspector-dark" picks up the Okabe-Ito palette', () => {
    const color = appliedColorFor('inspector-dark');
    // If the theme were unregistered, ECharts would fall back to its built-in
    // palette (starting #5470c6), not our first Okabe-Ito hue.
    expect(color[0]).toBe(CATEGORICAL[0]);
    expect(color[1]).toBe(CATEGORICAL[1]);
  });

  it('a chart selecting "inspector-light" picks up the same palette', () => {
    const color = appliedColorFor('inspector-light');
    expect(color[0]).toBe(CATEGORICAL[0]);
    expect(color[1]).toBe(CATEGORICAL[1]);
  });
});
