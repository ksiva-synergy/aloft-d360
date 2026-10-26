import echarts from './echartsCore';
import { CHART_TEXT, FONT_MONO } from '@/lib/typography/tokens';

// 8-step series palette: gold primary, then desaturated blues/slates that read on #0D1B2A.
// Steps 1 (#FDB515) and 7-8 (#8BAFC8/#5A82A0) match builder-text-muted/label tokens exactly.
// Steps 2-6 are a gradient from saturated mid-blue to the darkest border tone.
// Visual audit from Section 5 harness confirmed readability of all steps against navy.
const PALETTE = [
  '#FDB515', // 1 builder-gold — primary series, always most salient
  '#4A90C4', // 2 saturated slate-blue — clear differentiation from gold
  '#3A7AAD', // 3 mid slate-blue
  '#2E6490', // 4 deeper slate
  '#234F72', // 5 dark slate
  '#1E3A52', // 6 builder-border — used only as 6th+ series on lighter surfaces
  '#8BAFC8', // 7 builder-text-muted — light slate for secondary emphasis
  '#5A82A0', // 8 builder-text-label — lowest contrast, 8th series only
];

const spinorTheme = {
  color: PALETTE,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: FONT_MONO,
    fontSize: CHART_TEXT.axis,
    color: '#8BAFC8',
  },
  title: {
    textStyle: {
      color: '#F0F4F8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.tooltip,
    },
    subtextStyle: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
  },
  legend: {
    textStyle: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
    pageTextStyle: {
      color: '#8BAFC8',
    },
  },
  tooltip: {
    backgroundColor: '#0F2236',
    borderColor: '#FDB515',
    borderWidth: 1,
    borderRadius: 6,
    textStyle: {
      color: '#F0F4F8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
    axisPointer: {
      lineStyle: {
        color: 'rgba(253,181,21,0.3)',
      },
      crossStyle: {
        color: 'rgba(253,181,21,0.3)',
      },
    },
  },
  categoryAxis: {
    axisLine: {
      show: true,
      lineStyle: { color: '#1E3A52' },
    },
    axisTick: {
      lineStyle: { color: '#1E3A52' },
    },
    splitLine: {
      lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'solid' },
    },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
  },
  valueAxis: {
    axisLine: {
      show: true,
      lineStyle: { color: '#1E3A52' },
    },
    axisTick: {
      lineStyle: { color: '#1E3A52' },
    },
    splitLine: {
      lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'solid' },
    },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
  },
  timeAxis: {
    axisLine: {
      lineStyle: { color: '#1E3A52' },
    },
    splitLine: {
      lineStyle: { color: 'rgba(255,255,255,0.08)' },
    },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
    },
  },
  logAxis: {
    axisLine: {
      lineStyle: { color: '#1E3A52' },
    },
    splitLine: {
      lineStyle: { color: 'rgba(255,255,255,0.08)' },
    },
    axisLabel: {
      color: '#8BAFC8',
      fontFamily: FONT_MONO,
      fontSize: CHART_TEXT.axis,
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
    itemStyle: {
      barBorderRadius: [3, 3, 0, 0],
    },
  },
  pie: {
    itemStyle: {
      borderColor: '#0D1B2A',
      borderWidth: 2,
    },
  },
  scatter: {
    itemStyle: { opacity: 0.8 },
  },
};

echarts.registerTheme('spinor', spinorTheme);

export default spinorTheme;
