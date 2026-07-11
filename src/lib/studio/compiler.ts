import type { ChartDSLSpec, ChartKind, ChartEncoding } from './chart-dsl';
import type { ProfileResult, ColumnProfile } from './types';

type EChartsOption = Record<string, unknown>;

// ── Internal helpers ─────────────────────────────────────────────────────────

function getProfile(columnId: string, profile: ProfileResult): ColumnProfile | undefined {
  return profile.profiles.find(p => p.name === columnId);
}

function encodingsByRole(encodings: ChartEncoding[]): Record<string, ChartEncoding[]> {
  const map: Record<string, ChartEncoding[]> = {};
  for (const enc of encodings) {
    (map[enc.role] ??= []).push(enc);
  }
  return map;
}

function aggregate(
  rows: Record<string, unknown>[],
  groupCol: string,
  valueCol: string,
  fn: string,
): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[groupCol] ?? '(null)');
    const val = parseFloat(String(row[valueCol] ?? ''));
    if (!isNaN(val)) {
      const arr = groups.get(key);
      if (arr) arr.push(val);
      else groups.set(key, [val]);
    }
  }

  const result = new Map<string, number>();
  for (const [key, vals] of groups) {
    let v: number;
    switch (fn) {
      case 'sum':    v = vals.reduce((s, x) => s + x, 0); break;
      case 'mean':   v = vals.reduce((s, x) => s + x, 0) / vals.length; break;
      case 'count':  v = vals.length; break;
      case 'min':    v = Math.min(...vals); break;
      case 'max':    v = Math.max(...vals); break;
      case 'median': {
        const s = vals.slice().sort((a, b) => a - b);
        v = s.length % 2 === 0 ? (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : s[Math.floor(s.length / 2)];
        break;
      }
      default:       v = vals.reduce((s, x) => s + x, 0); break;
    }
    result.set(key, v);
  }
  return result;
}

function freedmanDiaconisBins(vals: number[]): number {
  let binCount = 20;
  if (vals.length >= 4) {
    const sorted = vals.slice().sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    if (iqr > 0) {
      const h = 2 * iqr * Math.pow(vals.length, -1 / 3);
      const range = sorted[sorted.length - 1] - sorted[0];
      binCount = Math.round(range / h);
    }
  }
  return Math.max(8, Math.min(40, binCount));
}

// ── Per-kind compilers ───────────────────────────────────────────────────────

function compileBar(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const aggFn = yEnc.aggregate && yEnc.aggregate !== 'none' ? yEnc.aggregate : 'sum';

  const agg = aggregate(rows, xEnc.columnId, yEnc.columnId, aggFn);
  const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const categories = sorted.map(([k]) => k);
  const values = sorted.map(([, v]) => v);

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 120, right: 24, top: 16, bottom: 40, containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: [...categories].reverse() },
    series: [{ type: 'bar', data: [...values].reverse(), barMaxWidth: 32 }],
  };
}

function compileStackedBar(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const seriesEnc = roles['series'][0];
  const aggFn = yEnc.aggregate && yEnc.aggregate !== 'none' ? yEnc.aggregate : 'sum';

  const categories = [...new Set(rows.map(r => String(r[xEnc.columnId] ?? '')))].slice(0, 30);
  const seriesValues = [...new Set(rows.map(r => String(r[seriesEnc.columnId] ?? '')))].slice(0, 8);

  const seriesData = seriesValues.map(sv => {
    const data = categories.map(cat => {
      const matching = rows.filter(
        r => String(r[xEnc.columnId] ?? '') === cat && String(r[seriesEnc.columnId] ?? '') === sv
      );
      if (matching.length === 0) return 0;
      const vals = matching.map(r => parseFloat(String(r[yEnc.columnId] ?? '')) || 0);
      if (aggFn === 'sum') return vals.reduce((s, x) => s + x, 0);
      if (aggFn === 'mean') return vals.reduce((s, x) => s + x, 0) / vals.length;
      if (aggFn === 'count') return vals.length;
      return vals.reduce((s, x) => s + x, 0);
    });
    return { name: sv, type: 'bar', stack: 'total', data };
  });

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: {},
    grid: { left: 60, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: seriesData,
  };
}

function compileLine(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const seriesEnc = roles['series']?.[0];

  const xData = [...new Set(rows.map(r => String(r[xEnc.columnId] ?? '')))];

  let series: object[];
  if (seriesEnc && new Set(rows.map(r => String(r[seriesEnc.columnId] ?? ''))).size <= 8) {
    const seriesValues = [...new Set(rows.map(r => String(r[seriesEnc.columnId] ?? '')))].slice(0, 8);
    series = seriesValues.map(sv => ({
      name: sv,
      type: 'line',
      smooth: true,
      data: xData.map(xv => {
        const matching = rows.filter(
          r => String(r[xEnc.columnId] ?? '') === xv && String(r[seriesEnc.columnId] ?? '') === sv
        );
        if (matching.length === 0) return null;
        return matching.reduce((s, r) => s + (parseFloat(String(r[yEnc.columnId] ?? '')) || 0), 0);
      }),
      symbol: 'circle',
      symbolSize: 4,
    }));
  } else {
    series = [{
      name: yEnc.columnId,
      type: 'line',
      smooth: true,
      data: xData.map(xv => {
        const matching = rows.filter(r => String(r[xEnc.columnId] ?? '') === xv);
        if (matching.length === 0) return null;
        return matching.reduce((s, r) => s + (parseFloat(String(r[yEnc.columnId] ?? '')) || 0), 0);
      }),
      symbol: 'circle',
      symbolSize: 4,
    }];
  }

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    legend: seriesEnc ? {} : { show: false },
    grid: { left: 60, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: xData },
    yAxis: { type: 'value', name: yEnc.columnId },
    series,
    ...(rows.length > 2000 ? {
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, height: 20, bottom: 4 },
        { type: 'inside', xAxisIndex: 0 },
      ],
    } : {}),
  };
}

function compileArea(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const option = compileLine(spec, roles, rows) as Record<string, unknown>;
  const series = option.series as { areaStyle?: object }[];
  for (const s of series) {
    s.areaStyle = { opacity: 0.3 };
  }
  return option;
}

function compilePie(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const aggFn = yEnc.aggregate && yEnc.aggregate !== 'none' ? yEnc.aggregate : 'sum';

  const agg = aggregate(rows, xEnc.columnId, yEnc.columnId, aggFn);
  const pieData = [...agg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {d}%' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['50%', '45%'],
      data: pieData,
      label: { show: false },
      labelLine: { show: false },
    }],
  };
}

function compileScatter(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const colorEnc = roles['color']?.[0] || roles['series']?.[0];
  const sample = rows.slice(0, 2000);

  let series: object[];
  if (colorEnc && new Set(sample.map(r => String(r[colorEnc.columnId] ?? ''))).size <= 6) {
    const colorValues = [...new Set(sample.map(r => String(r[colorEnc.columnId] ?? '')))].slice(0, 6);
    series = colorValues.map(cv => ({
      name: cv,
      type: 'scatter',
      data: sample
        .filter(r => String(r[colorEnc.columnId] ?? '') === cv)
        .map(r => [r[xEnc.columnId], r[yEnc.columnId]]),
      symbolSize: 5,
    }));
  } else {
    series = [{
      name: `${xEnc.columnId} vs ${yEnc.columnId}`,
      type: 'scatter',
      data: sample.map(r => [r[xEnc.columnId], r[yEnc.columnId]]),
      symbolSize: 5,
    }];
  }

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    legend: colorEnc ? {} : { show: false },
    grid: { left: 60, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'value', name: xEnc.columnId },
    yAxis: { type: 'value', name: yEnc.columnId },
    series,
  };
}

function compileHeatmap(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];
  const valEnc = roles['value'][0];

  const top30 = (col: string) => {
    const freq = new Map<string, number>();
    for (const row of rows) {
      const k = String(row[col] ?? '');
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([v]) => v);
  };

  const xVals = top30(xEnc.columnId);
  const yVals = top30(yEnc.columnId);
  const xSet = new Set(xVals);
  const ySet = new Set(yVals);

  const aggMap = new Map<string, number>();
  for (const row of rows) {
    const xk = String(row[xEnc.columnId] ?? '');
    const yk = String(row[yEnc.columnId] ?? '');
    if (!xSet.has(xk) || !ySet.has(yk)) continue;
    const key = `${xk}\u0000${yk}`;
    aggMap.set(key, (aggMap.get(key) ?? 0) + (parseFloat(String(row[valEnc.columnId] ?? 0)) || 0));
  }

  const heatData: number[][] = [];
  for (const [key, val] of aggMap) {
    const [xk, yk] = key.split('\u0000');
    heatData.push([xVals.indexOf(xk), yVals.indexOf(yk), val]);
  }

  return {
    backgroundColor: 'transparent',
    tooltip: { position: 'top' },
    grid: { left: 80, right: 24, top: 32, bottom: 60, containLabel: true },
    xAxis: { type: 'category', data: xVals },
    yAxis: { type: 'category', data: yVals },
    visualMap: {
      min: 0,
      max: Math.max(...heatData.map(d => d[2]), 1),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
    },
    series: [{ type: 'heatmap', data: heatData, label: { show: false } }],
  };
}

function compileBoxplot(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x'][0];
  const yEnc = roles['y'][0];

  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[xEnc.columnId] ?? '');
    const val = parseFloat(String(row[yEnc.columnId] ?? ''));
    if (!isNaN(val)) {
      const arr = groups.get(key);
      if (arr) arr.push(val);
      else groups.set(key, [val]);
    }
  }

  const categories = [...groups.keys()].slice(0, 20);
  const boxData = categories.map(cat => {
    const vals = (groups.get(cat) ?? []).sort((a, b) => a - b);
    if (vals.length < 5) return [0, 0, 0, 0, 0];
    const q1 = vals[Math.floor(vals.length * 0.25)];
    const q2 = vals[Math.floor(vals.length * 0.5)];
    const q3 = vals[Math.floor(vals.length * 0.75)];
    const min = vals[0];
    const max = vals[vals.length - 1];
    return [min, q1, q2, q3, max];
  });

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    grid: { left: 60, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value', name: yEnc.columnId },
    series: [{ type: 'boxplot', data: boxData }],
  };
}

function compileHistogram(
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
): EChartsOption {
  const xEnc = roles['x']?.[0] || roles['value']?.[0];
  const vals = rows
    .map(r => parseFloat(String(r[xEnc.columnId] ?? '')))
    .filter(v => !isNaN(v));

  const binCount = freedmanDiaconisBins(vals);
  const minVal = vals.length ? Math.min(...vals) : 0;
  const maxVal = vals.length ? Math.max(...vals) : 1;
  const binWidth = (maxVal - minVal) / binCount || 1;

  const bins: number[] = Array(binCount).fill(0);
  for (const v of vals) {
    const idx = Math.min(Math.floor((v - minVal) / binWidth), binCount - 1);
    bins[idx]++;
  }

  const labels = bins.map((_, i) => (minVal + i * binWidth).toFixed(2));

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 24, top: 32, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', name: 'count' },
    series: [{ type: 'bar', data: bins, barWidth: '90%', barGap: '-100%' }],
  };
}

// ── Dispatch table ───────────────────────────────────────────────────────────

const KIND_COMPILERS: Record<ChartKind, (
  spec: ChartDSLSpec,
  roles: Record<string, ChartEncoding[]>,
  rows: Record<string, unknown>[],
) => EChartsOption> = {
  bar: compileBar,
  'stacked-bar': compileStackedBar,
  line: compileLine,
  area: compileArea,
  pie: compilePie,
  scatter: compileScatter,
  heatmap: compileHeatmap,
  boxplot: compileBoxplot,
  histogram: compileHistogram,
};

/**
 * Compiles a validated ChartDSLSpec into a fully-resolved EChartsOption.
 * Theme tokens are applied by ECharts at render time via the registered theme name;
 * the compiler produces a theme-agnostic structural option.
 */
export function compileSpecToOption(
  spec: ChartDSLSpec,
  profile: ProfileResult,
  rows: Record<string, unknown>[],
  theme: 'aloft-dark' | 'aloft-light' = 'aloft-dark',
): EChartsOption {
  const limited = spec.limit ? rows.slice(0, spec.limit) : rows;
  const roles = encodingsByRole(spec.encodings);

  const compiler = KIND_COMPILERS[spec.kind];
  if (!compiler) {
    throw new Error(`No compiler for chart kind: ${spec.kind}`);
  }

  const option = compiler(spec, roles, limited);

  // Title is applied structurally (theme colors come from registerTheme)
  if (spec.title) {
    option.title = {
      text: spec.title,
      ...(spec.subtitle ? { subtext: spec.subtitle } : {}),
    };
  }

  return option;
}
