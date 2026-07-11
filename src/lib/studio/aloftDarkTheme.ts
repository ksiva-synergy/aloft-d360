// aloft-dark ECharts theme — hardcoded hex/font names (CSS vars not readable in SSR).
// Source of record: globals.css lines 37-38, tailwind.config.js lines 107-109, 132-140.
// backgroundColor is 'transparent' in-app (inherits card surface);
// S5 ssr-render.ts passes '#003262' opaque navy to Resvg for PNG digest output.

const DARK_PALETTE = [
  '#FDB515', // 1 gold — primary series
  '#4A90C4', // 2 saturated slate-blue
  '#3A7AAD', // 3 mid slate-blue
  '#2E6490', // 4 deeper slate
  '#234F72', // 5 dark slate
  '#8BAFC8', // 6 light slate
  '#5A82A0', // 7 medium slate
  '#1E3A52', // 8 border tone
];

export const aloftDarkTheme = {
  color: DARK_PALETTE,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: "'Inter Tight', sans-serif",
    fontSize: 11,
    color: '#F0F4F8',
  },
  title: {
    textStyle: {
      color: '#F0F4F8',
      fontFamily: "'Inter Tight', sans-serif",
      fontSize: 13,
    },
    subtextStyle: {
      color: '#8BAFC8',
      fontFamily: "'Inter Tight', sans-serif",
      fontSize: 11,
    },
  },
  legend: {
    textStyle: {
      color: '#8BAFC8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
    },
    pageTextStyle: { color: '#8BAFC8' },
  },
  tooltip: {
    backgroundColor: '#0F2236',
    borderColor: '#FDB515',
    borderWidth: 1,
    borderRadius: 6,
    textStyle: {
      color: '#F0F4F8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    axisPointer: {
      lineStyle: { color: 'rgba(253,181,21,0.3)' },
      crossStyle: { color: 'rgba(253,181,21,0.3)' },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: '#1E3A52' } },
    axisTick: { lineStyle: { color: '#1E3A52' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'solid' } },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  valueAxis: {
    axisLine: { show: true, lineStyle: { color: '#1E3A52' } },
    axisTick: { lineStyle: { color: '#1E3A52' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'solid' } },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: '#1E3A52' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  logAxis: {
    axisLine: { lineStyle: { color: '#1E3A52' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  line: {
    itemStyle: { borderWidth: 2 },
    lineStyle: { width: 2 },
    symbolSize: 5,
    symbol: 'circle',
    smooth: false,
  },
  bar: {
    itemStyle: { barBorderRadius: [3, 3, 0, 0] },
  },
  pie: {
    itemStyle: { borderColor: '#003262', borderWidth: 2 },
  },
  scatter: {
    itemStyle: { opacity: 0.8 },
  },
};

// aloft-light ECharts theme — light mode counterpart.
// Source of record: globals.css :root (lines 17-98), tailwind.config.js.
// Light ground: #fafaf7; dark text: #0f172a; accent unchanged: #FDB515.

const LIGHT_PALETTE = [
  '#003262', // 1 navy — primary series on light bg (gold is accent, not primary on light)
  '#FDB515', // 2 gold — secondary series
  '#2E6490', // 3 deeper slate
  '#4A90C4', // 4 saturated slate-blue
  '#0369a1', // 5 marine-700
  '#075985', // 6 marine-800
  '#5A82A0', // 7 medium slate
  '#8892A4', // 8 muted
];

export const aloftLightTheme = {
  color: LIGHT_PALETTE,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: "'Inter Tight', sans-serif",
    fontSize: 11,
    color: '#0f172a',
  },
  title: {
    textStyle: {
      color: '#0f172a',
      fontFamily: "'Inter Tight', sans-serif",
      fontSize: 13,
    },
    subtextStyle: {
      color: '#475569',
      fontFamily: "'Inter Tight', sans-serif",
      fontSize: 11,
    },
  },
  legend: {
    textStyle: {
      color: '#475569',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
    },
    pageTextStyle: { color: '#475569' },
  },
  tooltip: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    borderRadius: 6,
    textStyle: {
      color: '#374151',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    axisPointer: {
      lineStyle: { color: 'rgba(0,50,98,0.2)' },
      crossStyle: { color: 'rgba(0,50,98,0.2)' },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: '#e2e8f0' } },
    axisTick: { lineStyle: { color: '#e2e8f0' } },
    splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'solid' } },
    axisLabel: {
      color: '#475569',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  valueAxis: {
    axisLine: { show: true, lineStyle: { color: '#e2e8f0' } },
    axisTick: { lineStyle: { color: '#e2e8f0' } },
    splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'solid' } },
    axisLabel: {
      color: '#475569',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: '#e2e8f0' } },
    splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
    axisLabel: {
      color: '#475569',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  logAxis: {
    axisLine: { lineStyle: { color: '#e2e8f0' } },
    splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
    axisLabel: {
      color: '#475569',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
  },
  line: {
    itemStyle: { borderWidth: 2 },
    lineStyle: { width: 2 },
    symbolSize: 5,
    symbol: 'circle',
    smooth: false,
  },
  bar: {
    itemStyle: { barBorderRadius: [3, 3, 0, 0] },
  },
  pie: {
    itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
  },
  scatter: {
    itemStyle: { opacity: 0.8 },
  },
};
