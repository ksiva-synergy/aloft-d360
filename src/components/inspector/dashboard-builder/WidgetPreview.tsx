'use client';

import React from 'react';
import type { WidgetSpec } from '@/lib/dashboards/types';
import { isRawSqlWidget } from '@/lib/dashboards/types';
import StudioChart from '@/components/studio/StudioChart';
import { widgetToChartSpec, type DefinitionMap } from './widget-option';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

interface WidgetPreviewProps {
  widget: WidgetSpec;
  definitions: DefinitionMap;
  /**
   * Executed result rows (from the widget-data route). When provided and
   * non-empty, the chart is filled with real values and the "PREVIEW — NO DATA"
   * overlay is removed. When undefined/empty, the placeholder behaviour is
   * unchanged — the builder renders placeholders until a save happens.
   *
   * Rows are keyed by the compiler's snake_case alias (toAlias(label)); the
   * mapping in widget-option.ts handles the lookup. See §4.5.
   */
  rows?: Record<string, unknown>[];
}

/**
 * Renders a preview of a widget inside the builder grid (placeholder) or the
 * read-only viewer (live data). Converts WidgetSpec → ChartSpec for StudioChart.
 * If the widget has no semantic query configured yet, shows a placeholder.
 */
export function WidgetPreview({ widget, definitions, rows }: WidgetPreviewProps) {
  // Raw-SQL widgets (Phase 3.5C) have no semanticQuery — they render straight
  // from their frozen chartConfig + result columns via widgetToChartSpec.
  const hasDims = isRawSqlWidget(widget) ? false : widget.semanticQuery.dimensions.length > 0;
  const hasMeasures = isRawSqlWidget(widget) ? false : widget.semanticQuery.measures.length > 0;

  if (!isRawSqlWidget(widget) && !hasDims && !hasMeasures) {
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

  const chartSpec = widgetToChartSpec(widget, definitions, rows);

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
