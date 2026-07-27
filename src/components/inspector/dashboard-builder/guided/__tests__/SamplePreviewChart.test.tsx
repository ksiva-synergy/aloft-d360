// @vitest-environment jsdom
/**
 * SamplePreviewChart — the six render-states stay DISTINCT (anti-false-green).
 *
 * "sample" is the SIXTH value added to data-widget-render-state; it must never
 * collapse the existing five (awaiting_data / empty / ok / error /
 * model_not_governed). A viewer can always tell which of the six they are
 * looking at. ECharts itself is stubbed globally (vitest.setup.ts) — jsdom has no
 * canvas — so these assert on the DISTINCT chrome around the mount, not on pixels.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SamplePreviewChart } from '../SamplePreviewChart';
import type { WidgetRenderState } from '@/lib/dashboards/widget-render-state';
import type { RowsToOptionResult } from '@/lib/dashboards/rows-to-option';

const M = ['Total Revenue'];
const D = ['Month'];

function stateAttr(): string | null {
  return screen.getByTestId('widget-chart-area').getAttribute('data-widget-render-state');
}

const liveChart: RowsToOptionResult = {
  isEmpty: false,
  categories: ['Jan', 'Feb'],
  dimAliases: ['month'],
  series: [{ measureId: 'm_rev', name: 'Total Revenue', alias: 'total_revenue', data: [100, 140], unit: null, format: null }],
};

describe('SamplePreviewChart — distinct render states', () => {
  it('SAMPLE mode (no renderState) → "sample" state + "Sample data" chip, not "ok"', async () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} />);
    expect(stateAttr()).toBe('sample');
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
    // After mount the (stubbed) ECharts renders — proving sample data reaches it.
    await waitFor(() => expect(screen.getByTestId('echarts-mock')).toBeInTheDocument());
  });

  it('LOADING → shaped skeleton, state "loading", never a chart', () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={{ kind: 'loading' }} />);
    expect(stateAttr()).toBe('loading');
    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('echarts-mock')).not.toBeInTheDocument();
  });

  it('OK → "ok" state + "Live" chip, and the real series data reaches the option', async () => {
    const rs: WidgetRenderState = { kind: 'ok', chart: liveChart, sql: 'SELECT 1', isDraft: false };
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} measureIds={['m_rev']} renderState={rs} />);
    expect(stateAttr()).toBe('ok');
    expect(screen.getByText(/^live$/i)).toBeInTheDocument();
    await waitFor(() => {
      const opt = JSON.parse(screen.getByTestId('echarts-mock').getAttribute('data-echarts-option') || '{}');
      expect(opt.series[0].data).toEqual([100, 140]); // real rows, toAlias-bound upstream
    });
  });

  it('OK + isDraft → also stamps the Draft badge (does not replace "Live")', () => {
    const rs: WidgetRenderState = { kind: 'ok', chart: liveChart, sql: 'x', isDraft: true };
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={rs} />);
    expect(stateAttr()).toBe('ok');
    expect(screen.getByTestId('draft-badge')).toBeInTheDocument();
  });

  it('EMPTY delegates to NotWiredChart and stays "empty" (not "sample", not "ok")', () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={{ kind: 'empty' }} />);
    expect(stateAttr()).toBe('empty');
    expect(screen.queryByTestId('echarts-mock')).not.toBeInTheDocument();
  });

  it('ERROR delegates and stays "error"', () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={{ kind: 'error', message: 'boom' }} />);
    expect(stateAttr()).toBe('error');
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
  });

  it('MODEL_NOT_GOVERNED delegates and stays "model_not_governed"', () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={{ kind: 'model_not_governed', message: 'publish it' }} />);
    expect(stateAttr()).toBe('model_not_governed');
  });

  it('AWAITING_DATA delegates and stays "awaiting_data" (the not-wired scaffold)', () => {
    render(<SamplePreviewChart chartKind="bar" measureLabels={M} dimensionLabels={D} renderState={{ kind: 'awaiting_data' }} />);
    expect(stateAttr()).toBe('awaiting_data');
  });
});
