// CHOKEPOINT: all Studio code imports echarts from this module only.
// Never import from the 'echarts' barrel directly — bundle size invariant (A2/R8).
// Equivalent to the execute_url pattern in src/lib/databricks/execute.ts.
import * as echarts from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  TitleComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { aloftDarkTheme, aloftLightTheme } from './aloftDarkTheme';

// Histogram is rendered as a BarChart with barWidth/barGap overrides — no separate HistogramChart.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  TitleComponent,
  VisualMapComponent,
  CanvasRenderer,
  SVGRenderer,
]);

echarts.registerTheme('aloft-dark', aloftDarkTheme);
echarts.registerTheme('aloft-light', aloftLightTheme);

export default echarts;
