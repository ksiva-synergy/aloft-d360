/**
 * src/lib/studio/inspectorEchartsTheme.ts
 *
 * ECharts themes for the redesigned GUIDED dashboard-builder surfaces
 * (inspector-dark / inspector-light). Registered globally via echartsCore.ts and
 * selected with `theme="inspector-dark"|"inspector-light"` — the palette rides on
 * the theme, NEVER inline per-chart (redesign spec §1).
 *
 * Palette + surfaces come from the shared token module
 * (src/lib/dashboards/inspector-viz-tokens.ts) so a blueprint thumbnail, the
 * refine canvas, and any inspector-themed viewer chart agree on the exact hues.
 * Values are inlined as literals here (not `var(--iv-*)`) because ECharts reads a
 * plain JS theme object — CSS custom properties are not resolvable inside it,
 * same constraint noted in aloftDarkTheme.ts.
 *
 * Restraint per spec: no drop-shadows, minimal gridlines, Inter for all text
 * (mono is reserved for the SQL trust panel, which is not a chart).
 */

import {
  PREVIEW_PALETTE,
  SURFACE_DARK,
  SURFACE_LIGHT,
  ACCENT_AMBER,
  UI_FONT,
} from '@/lib/dashboards/inspector-viz-tokens';

// PREVIEW_PALETTE is gold-primary → slate blues, optimised for the dark canvas.
// ECharts wants a mutable string[].
const PALETTE = [...PREVIEW_PALETTE];

// ── inspector-dark ────────────────────────────────────────────────────────────
const DARK_INK = '#e6edf3';
const DARK_MUTED = '#8892A4';
const DARK_LINE = SURFACE_DARK.border; // #262d36
const DARK_SPLIT = 'rgba(255,255,255,0.05)'; // faint — no gridline clutter

export const inspectorDarkTheme = {
  color: PALETTE,
  backgroundColor: 'transparent', // inherits the card surface
  textStyle: { fontFamily: UI_FONT, fontSize: 11, color: DARK_INK },
  title: {
    textStyle: { color: DARK_INK, fontFamily: UI_FONT, fontSize: 13 },
    subtextStyle: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  legend: {
    textStyle: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 10 },
    pageTextStyle: { color: DARK_MUTED },
  },
  tooltip: {
    backgroundColor: SURFACE_DARK.cardElevated,
    borderColor: SURFACE_DARK.border,
    borderWidth: 1,
    borderRadius: 6,
    textStyle: { color: DARK_INK, fontFamily: UI_FONT, fontSize: 11 },
    axisPointer: {
      lineStyle: { color: `${ACCENT_AMBER}55` },
      crossStyle: { color: `${ACCENT_AMBER}55` },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: DARK_LINE } },
    axisTick: { show: false },
    splitLine: { show: false }, // category gridlines off — restraint
    axisLabel: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: DARK_SPLIT, type: 'solid' } },
    axisLabel: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: DARK_LINE } },
    splitLine: { show: false },
    axisLabel: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  logAxis: {
    axisLine: { lineStyle: { color: DARK_LINE } },
    splitLine: { lineStyle: { color: DARK_SPLIT } },
    axisLabel: { color: DARK_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  line: { lineStyle: { width: 2 }, symbolSize: 4, symbol: 'circle', smooth: 0.3 },
  bar: { itemStyle: { barBorderRadius: [4, 4, 0, 0], opacity: 0.92 }, barMaxWidth: 48 },
  pie: { itemStyle: { borderColor: SURFACE_DARK.card, borderWidth: 2 } },
  scatter: { itemStyle: { opacity: 0.85 } },
};

// ── inspector-light ─────────────────────────────────────────────────────────
const LIGHT_INK = '#0f172a';
const LIGHT_MUTED = '#5A6A7A';
const LIGHT_LINE = SURFACE_LIGHT.border; // #C8C2AD
const LIGHT_SPLIT = 'rgba(0,0,0,0.06)';

export const inspectorLightTheme = {
  color: PALETTE,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: UI_FONT, fontSize: 11, color: LIGHT_INK },
  title: {
    textStyle: { color: LIGHT_INK, fontFamily: UI_FONT, fontSize: 13 },
    subtextStyle: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  legend: {
    textStyle: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 10 },
    pageTextStyle: { color: LIGHT_MUTED },
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: LIGHT_LINE,
    borderWidth: 1,
    borderRadius: 6,
    textStyle: { color: LIGHT_INK, fontFamily: UI_FONT, fontSize: 11 },
    axisPointer: {
      lineStyle: { color: 'rgba(0,50,98,0.2)' },
      crossStyle: { color: 'rgba(0,50,98,0.2)' },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: LIGHT_LINE } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: LIGHT_SPLIT, type: 'solid' } },
    axisLabel: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  timeAxis: {
    axisLine: { lineStyle: { color: LIGHT_LINE } },
    splitLine: { show: false },
    axisLabel: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  logAxis: {
    axisLine: { lineStyle: { color: LIGHT_LINE } },
    splitLine: { lineStyle: { color: LIGHT_SPLIT } },
    axisLabel: { color: LIGHT_MUTED, fontFamily: UI_FONT, fontSize: 11 },
  },
  line: { lineStyle: { width: 2 }, symbolSize: 4, symbol: 'circle', smooth: 0.3 },
  bar: { itemStyle: { barBorderRadius: [4, 4, 0, 0], opacity: 0.92 }, barMaxWidth: 48 },
  pie: { itemStyle: { borderColor: '#ffffff', borderWidth: 2 } },
  scatter: { itemStyle: { opacity: 0.85 } },
};
