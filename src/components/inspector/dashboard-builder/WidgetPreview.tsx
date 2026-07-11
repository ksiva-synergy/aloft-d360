'use client';

import React from 'react';
import type { WidgetSpec } from '@/lib/dashboards/types';
import type { ChartSpec } from '@/lib/studio/types';
import StudioChart from '@/components/studio/StudioChart';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

interface WidgetPreviewProps {
  widget: WidgetSpec;
  definitions: Map<string, { label: string; status: string; aggregate?: string; expression?: string | null; metric_type?: string }>;
}

/**
 * Renders a live preview of a widget inside the builder grid.
 * Converts WidgetSpec → ChartSpec for StudioChart consumption.
 * If the widget has no semantic query configured yet, shows a placeholder.
 */
export function WidgetPreview({ widget, definitions }: WidgetPreviewProps) {
  const hasDims = widget.semanticQuery.dimensions.length > 0;
  const hasMeasures = widget.semanticQuery.measures.length > 0;

  if (!hasDims && !hasMeasures) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 6,
          padding: 12,
        }}
      >
        <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-label)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {widget.chartKind.toUpperCase()}
        </span>
        <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', textAlign: 'center' }}>
          Assign dimensions & measures
        </span>
      </div>
    );
  }

  // Build a synthetic ChartSpec from WidgetSpec for StudioChart
  const chartSpec = widgetToChartSpec(widget, definitions);

  if (!chartSpec) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
        }}
      >
        <span style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', textAlign: 'center' }}>
          Configure chart axes to see preview
        </span>
      </div>
    );
  }

  return <StudioChart spec={chartSpec} height={200} className="w-full h-full" />;
}

/**
 * Converts a WidgetSpec + live definitions into a ChartSpec that StudioChart can render.
 * Returns null if there isn't enough information to render a meaningful chart.
 */
function widgetToChartSpec(
  widget: WidgetSpec,
  definitions: Map<string, { label: string; status: string; aggregate?: string }>,
): ChartSpec | null {
  const { chartKind, chartConfig, semanticQuery, title } = widget;

  // Resolve labels for configured axes
  const xLabel = chartConfig.x ?? resolveFirstDimLabel(semanticQuery, definitions);
  const yLabels = chartConfig.y ?? resolveAllMeasureLabels(semanticQuery, definitions);

  if (!xLabel && chartKind !== 'kpi') return null;
  if (yLabels.length === 0 && chartKind !== 'kpi') return null;

  // For KPI, just show the measure name as the "title" (value)
  if (chartKind === 'kpi') {
    const measureLabel = yLabels[0] ?? 'Value';
    return {
      id: widget.widgetId,
      kind: 'kpi',
      title: measureLabel,
      rationale: title,
      echartsOption: {},
      rank: 0,
      alternatives: [],
    };
  }

  // Build a basic echarts option for preview
  const echartsOption = buildPreviewOption(chartKind, xLabel, yLabels, chartConfig.series);

  return {
    id: widget.widgetId,
    kind: chartKind,
    title,
    rationale: `${chartKind} · ${xLabel} × ${yLabels.join(', ')}`,
    x: xLabel ?? undefined,
    y: yLabels,
    series: chartConfig.series ?? undefined,
    value: chartConfig.value ?? undefined,
    echartsOption,
    rank: 0,
    alternatives: [],
  };
}

function resolveFirstDimLabel(
  sq: WidgetSpec['semanticQuery'],
  defs: Map<string, { label: string }>,
): string | null {
  if (sq.dimensions.length === 0) return null;
  const def = defs.get(sq.dimensions[0].dimensionId);
  return def?.label ?? sq.dimensions[0].dimensionId.slice(-6);
}

function resolveAllMeasureLabels(
  sq: WidgetSpec['semanticQuery'],
  defs: Map<string, { label: string }>,
): string[] {
  return sq.measures.map((m) => {
    const def = defs.get(m.measureId);
    return def?.label ?? m.measureId.slice(-6);
  });
}

function buildPreviewOption(
  kind: string,
  xLabel: string | null,
  yLabels: string[],
  _series?: string,
): object {
  // Generates a placeholder echarts option showing axes and a "no data" state
  const baseOption = {
    animation: false,
    grid: { left: 40, right: 16, top: 24, bottom: 32 },
    xAxis: {
      type: kind === 'bar' ? 'category' : (kind === 'scatter' ? 'value' : 'category'),
      name: xLabel ?? '',
      nameTextStyle: { fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
      data: [],
    },
    yAxis: {
      type: 'value',
      name: yLabels[0] ?? '',
      nameTextStyle: { fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
    },
    series: yLabels.map((label) => ({
      name: label,
      type: kind === 'donut' ? 'pie' : kind === 'scatter' ? 'scatter' : kind === 'histogram' ? 'bar' : kind,
      data: [],
    })),
    graphic: {
      elements: [{
        type: 'text',
        style: {
          text: 'PREVIEW — NO DATA',
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          fill: '#8892A4',
        },
        left: 'center',
        top: 'center',
      }],
    },
  };

  return baseOption;
}
