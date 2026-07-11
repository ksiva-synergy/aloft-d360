'use client';

import React, { useMemo, useCallback } from 'react';
import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { X, AlertTriangle, AlertCircle } from 'lucide-react';
import type { WidgetSpec } from '@/lib/dashboards/types';
import type { DriftStatus } from './builder-store';
import { useBuilderStore } from './builder-store';
import { WidgetPreview } from './WidgetPreview';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

const GRID_COLS = 12;
const ROW_HEIGHT = 60;

interface BuilderGridProps {
  widgets: WidgetSpec[];
  definitions: Map<string, { label: string; status: string; aggregate?: string; expression?: string | null; metric_type?: string }>;
  readOnly?: boolean;
}

export function BuilderGrid({ widgets, definitions, readOnly }: BuilderGridProps) {
  const selectedWidgetId = useBuilderStore((s) => s.selectedWidgetId);
  const driftMap = useBuilderStore((s) => s.driftMap);
  const selectWidget = useBuilderStore((s) => s.selectWidget);
  const updateWidgetPosition = useBuilderStore((s) => s.updateWidgetPosition);
  const removeWidget = useBuilderStore((s) => s.removeWidget);

  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 900 });

  const layout: Layout = useMemo(
    () =>
      widgets.map((w) => ({
        i: w.widgetId,
        x: w.position.col,
        y: w.position.row,
        w: w.position.w,
        h: w.position.h,
        minW: 2,
        minH: 2,
      })),
    [widgets],
  );

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      for (const item of newLayout) {
        const widget = widgets.find((w) => w.widgetId === item.i);
        if (!widget) continue;
        const pos = widget.position;
        if (pos.col !== item.x || pos.row !== item.y || pos.w !== item.w || pos.h !== item.h) {
          updateWidgetPosition(item.i, { col: item.x, row: item.y, w: item.w, h: item.h });
        }
      }
    },
    [widgets, updateWidgetPosition],
  );

  if (widgets.length === 0) {
    return (
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <span style={{ ...MONO, fontSize: 11, color: 'var(--builder-text-label)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          NO WIDGETS YET
        </span>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)', maxWidth: 260, textAlign: 'center' }}>
          Add a widget using the toolbar, then assign dimensions and measures from the picker.
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {mounted && (
        <GridLayout
          width={width - 32}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [12, 12] as const, containerPadding: [0, 0] as const }}
          dragConfig={{ enabled: !readOnly, handle: '.widget-drag-handle' }}
          resizeConfig={{ enabled: !readOnly }}
          compactor={verticalCompactor}
          onLayoutChange={handleLayoutChange}
          autoSize
        >
          {widgets.map((widget) => {
            const drift = driftMap[widget.widgetId];
            const isSelected = selectedWidgetId === widget.widgetId;
            return (
              <div
                key={widget.widgetId}
                onClick={() => selectWidget(widget.widgetId)}
                style={{
                  background: 'var(--builder-surface-raised)',
                  border: `1px solid ${isSelected ? '#FDB515' : 'var(--builder-border)'}`,
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  outline: isSelected ? '1px solid rgba(253,181,21,0.3)' : 'none',
                  outlineOffset: 2,
                }}
              >
                {/* Widget header — drag handle */}
                <div
                  className="widget-drag-handle"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderBottom: '1px solid var(--builder-border)',
                    cursor: 'grab',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      ...MONO,
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--builder-text)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {widget.title || 'Untitled Widget'}
                  </span>
                  <DriftBadge drift={drift} />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeWidget(widget.widgetId); }}
                    title="Remove widget"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--builder-text-muted)',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* Widget body — preview */}
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <WidgetPreview widget={widget} definitions={definitions} />
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}

function DriftBadge({ drift }: { drift?: { status: DriftStatus; changedMeasures?: string[]; unavailableIds?: string[] } }) {
  if (!drift || drift.status === 'ok') return null;

  if (drift.status === 'unavailable') {
    const count = drift.unavailableIds?.length ?? 0;
    const tip = count > 0
      ? `Definition unavailable — ${count} referenced ID(s) archived or deleted`
      : 'Definition unavailable — referenced dimension or measure has been archived or deleted';
    return (
      <span
        title={tip}
        style={{
          ...MONO,
          fontSize: 8,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '2px 5px',
          borderRadius: 2,
          background: 'rgba(239,68,68,0.12)',
          color: '#F87171',
          border: '1px solid rgba(239,68,68,0.25)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          flexShrink: 0,
        }}
      >
        <AlertCircle size={9} />
        UNAVAILABLE
      </span>
    );
  }

  const count = drift.changedMeasures?.length ?? 0;
  const tip = count > 0
    ? `${count} measure(s) changed since last save — re-save to accept current computation`
    : 'Definition changed since last save — re-save to accept current computation';
  return (
    <span
      title={tip}
      style={{
        ...MONO,
        fontSize: 8,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '2px 5px',
        borderRadius: 2,
        background: 'rgba(253,181,21,0.12)',
        color: '#FDB515',
        border: '1px solid rgba(253,181,21,0.25)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={9} />
      CHANGED
    </span>
  );
}
