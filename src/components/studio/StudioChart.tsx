'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { ChartSpec } from '@/lib/studio/types';
import { useIsDark } from '@/hooks/useIsDark';

// Side-effect: legacy 'spinor' theme — superseded by aloft-dark; remove after I1 migration confirms visual parity.
import '@/lib/studio/spinorEchartsTheme';
// aloft-dark + aloft-light themes registered via echartsCore.ts (shared init for client + SSR).
import '@/lib/studio/echartsCore';

// Dynamic import with ssr:false — ECharts uses browser APIs (canvas, ResizeObserver)
// that are unavailable during SSR. The skeleton shimmer prevents layout shift.
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

// Tooltip style constants — applied as a base overlay to every chart option to ensure
// ECharts 6.x theme-level tooltip config isn't silently overridden by per-chart options.
// Theme-aware: dark navy surface in dark mode, light surface in light mode.
const TOOLTIP_STYLE_DARK = {
  backgroundColor: '#0F2236',
  borderColor: '#FDB515',
  borderWidth: 1,
  textStyle: {
    color: '#F0F4F8',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
  },
};
const TOOLTIP_STYLE_LIGHT = {
  backgroundColor: 'rgba(255, 255, 255, 0.97)',
  borderColor: '#e5e7eb',
  borderWidth: 1,
  textStyle: {
    color: '#374151',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11,
  },
};

// Toolbox chart kinds that benefit from dataZoom (temporal/continuous x-axis).
const DATA_ZOOM_KINDS = new Set(['bar', 'line', 'scatter', 'histogram']);

interface StudioChartProps {
  spec: ChartSpec;
  height?: number;
  className?: string;
  // V4 prop — wired to column highlight interactions in V4. Stubbed here.
  highlightedColumns?: string[];
}

export default function StudioChart({
  spec,
  height = 320,
  className,
  highlightedColumns: _highlightedColumns,
}: StudioChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Holds the live ECharts instance, set via onChartReady callback.
  const instanceRef = useRef<{ resize: () => void } | null>(null);

  // Flip the registered ECharts theme with the global light/dark toggle.
  // echarts-for-react disposes and re-inits the instance when `theme` changes.
  const isDark = useIsDark();
  const chartTheme = isDark ? 'aloft-dark' : 'aloft-light';
  const TOOLTIP_STYLE = isDark ? TOOLTIP_STYLE_DARK : TOOLTIP_STYLE_LIGHT;

  const handleChartReady = useCallback((instance: { resize: () => void }) => {
    instanceRef.current = instance;
  }, []);

  // ResizeObserver on the wrapper div — reliably triggers resize when the
  // lightbox flex layout changes width/height. The echarts-for-react autoresize
  // prop only handles window resize events and misses flex-layout transitions
  // in the Studio lightbox (e.g. rail collapse, panel split changes).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      instanceRef.current?.resize();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  const toolbox = {
    show: true,
    right: 8,
    top: 4,
    feature: {
      saveAsImage: {
        show: true,
        backgroundColor: isDark ? '#0D1B2A' : '#ffffff',
        title: 'Save',
        iconStyle: { borderColor: isDark ? '#8BAFC8' : '#5A6A7A' },
      },
      ...(DATA_ZOOM_KINDS.has(spec.kind) && {
        dataZoom: {
          show: true,
          title: { zoom: 'Zoom', back: 'Reset' },
          iconStyle: { borderColor: isDark ? '#8BAFC8' : '#5A6A7A' },
        },
      }),
    },
  };

  const specOption = spec.echartsOption as Record<string, unknown>;
  const option = {
    ...specOption,
    // Merge tooltip: TOOLTIP_STYLE as base, then spec's trigger/axisPointer/etc on top.
    // This ensures ECharts 6.x theme-level tooltip config is never silently dropped
    // by per-chart tooltip objects in the spec.
    ...(specOption.tooltip != null
      ? { tooltip: { ...TOOLTIP_STYLE, ...(specOption.tooltip as object) } }
      : {}),
    toolbox,
  };

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ width: '100%', height }}
    >
      <React.Suspense fallback={<ChartSkeleton height={height} />}>
        <ReactECharts
          option={option}
          theme={chartTheme}
          opts={{ renderer: 'canvas' }}
          notMerge={true}
          style={{ width: '100%', height: '100%' }}
          onChartReady={handleChartReady}
        />
      </React.Suspense>
    </div>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{
        width: '100%',
        height,
        background: 'rgba(100,116,139,0.18)',
      }}
    />
  );
}
