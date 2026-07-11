import type { ProfileResult, ColumnProfile, ChartSpec } from './types';
import type { ChartDSLSpec, ChartEncoding } from './chart-dsl';
import { compileSpecToOption } from './compiler';

// ── Helpers (remain in recommender — not option-building) ────────────────────

function primaryNumeric(profiles: ColumnProfile[]): ColumnProfile | undefined {
  return profiles
    .filter(p => p.kind === 'numeric_continuous' || p.kind === 'numeric_discrete')
    .sort((a, b) => (b.stats?.mean ?? 0) - (a.stats?.mean ?? 0))[0];
}

function firstTemporal(profiles: ColumnProfile[]): ColumnProfile | undefined {
  return profiles.find(p => p.kind === 'temporal');
}

function firstCategorical(profiles: ColumnProfile[], maxCard = Infinity): ColumnProfile | undefined {
  return profiles.find(p => p.kind === 'categorical' && p.cardinality <= maxCard);
}

function isShareColumn(p: ColumnProfile): boolean {
  if (/pct|percent|share|ratio/i.test(p.name)) return true;
  if (p.topValues && p.topValues.length > 0) {
    const approxSum = p.topValues.reduce((s, v) => s + Number(v.value) * v.count, 0);
    if (Math.abs(approxSum - 100) < 2) return true;
  }
  return false;
}

// ── DSL spec construction helpers ────────────────────────────────────────────

function makeDSL(
  id: string,
  kind: ChartDSLSpec['kind'],
  title: string,
  encodings: ChartEncoding[],
  opts?: { subtitle?: string; limit?: number; themeSlot?: ChartDSLSpec['themeSlot'] },
): ChartDSLSpec {
  return {
    id,
    kind,
    title,
    encodings,
    ...(opts?.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts?.limit ? { limit: opts.limit } : {}),
    themeSlot: opts?.themeSlot ?? 'aloft-dark',
  };
}

function enc(columnId: string, role: ChartEncoding['role'], aggregate?: ChartEncoding['aggregate']): ChartEncoding {
  return { columnId, role, ...(aggregate && aggregate !== 'none' ? { aggregate } : {}) };
}

// ── DSL → ChartSpec wrapper ──────────────────────────────────────────────────

function dslToChartSpec(
  dsl: ChartDSLSpec,
  legacyKind: ChartSpec['kind'],
  rationale: string,
  rank: number,
  alternatives: string[],
  profile: ProfileResult,
  rows: Record<string, unknown>[],
): ChartSpec {
  const echartsOption = compileSpecToOption(dsl, profile, rows, dsl.themeSlot ?? 'aloft-dark');
  const xEnc = dsl.encodings.find(e => e.role === 'x');
  const yEncs = dsl.encodings.filter(e => e.role === 'y');
  const seriesEnc = dsl.encodings.find(e => e.role === 'series');
  const valueEnc = dsl.encodings.find(e => e.role === 'value');

  return {
    id: dsl.id,
    kind: legacyKind,
    title: dsl.title,
    rationale,
    x: xEnc?.columnId,
    y: yEncs.length ? yEncs.map(e => e.columnId) : undefined,
    series: seriesEnc?.columnId,
    value: valueEnc?.columnId,
    echartsOption,
    dsl,
    rank,
    alternatives,
  };
}

// ── KPI spec builder (NOT routed through DSL — stat tile, not a chart) ───────

function buildKpiSpec(result: ProfileResult, _rows: Record<string, unknown>[]): ChartSpec[] {
  const num = primaryNumeric(result.profiles.filter(p => p.kind !== 'identifier' && p.kind !== 'text'));
  const total = result.rowsSampled;

  const rowCountSpec: ChartSpec = {
    id: 'kpi-0',
    kind: 'kpi',
    title: `${total.toLocaleString()} ROWS`,
    rationale: 'row count',
    echartsOption: { backgroundColor: 'transparent' },
    rank: 0,
    alternatives: [],
  };

  const specs: ChartSpec[] = [rowCountSpec];

  if (num?.stats) {
    const sum = (num.stats.mean * total);
    const sumFormatted = sum >= 1_000_000
      ? (sum / 1_000_000).toFixed(2) + 'M'
      : sum >= 1_000
        ? (sum / 1_000).toFixed(1) + 'K'
        : sum.toFixed(1);

    specs.push({
      id: 'kpi-1',
      kind: 'kpi',
      title: `${sumFormatted}`,
      rationale: `${num.name}: total sum`,
      echartsOption: { backgroundColor: 'transparent' },
      rank: 0,
      alternatives: [],
    });

    const meanFormatted = num.stats.mean >= 1_000
      ? (num.stats.mean / 1_000).toFixed(2) + 'K'
      : num.stats.mean.toFixed(2);

    specs.push({
      id: 'kpi-2',
      kind: 'kpi',
      title: `${meanFormatted}`,
      rationale: `${num.name}: mean`,
      echartsOption: { backgroundColor: 'transparent' },
      rank: 0,
      alternatives: [],
    });
  }

  return specs;
}

// ── Main recommender ──────────────────────────────────────────────────────────

export function recommendCharts(
  result: ProfileResult,
  rows: Record<string, unknown>[],
): ChartSpec[] {
  const { profiles } = result;
  const specs: ChartSpec[] = [];

  const usableProfiles = profiles.filter(p => p.kind !== 'identifier' && p.kind !== 'text');

  const numPrimary   = primaryNumeric(usableProfiles);
  const temporal     = firstTemporal(usableProfiles);
  const categorical1 = firstCategorical(usableProfiles);

  // Rank 0 — KPI cards (not DSL-routed)
  specs.push(...buildKpiSpec(result, rows));

  // Rank 1 — line: temporal + primary numeric
  if (temporal && numPrimary) {
    const seriesCol = usableProfiles.find(
      p => p.kind === 'categorical' && p.cardinality <= 8 && p !== temporal
    );
    const alts: string[] = [];
    const encodings: ChartEncoding[] = [
      enc(temporal.name, 'x'),
      enc(numPrimary.name, 'y', 'sum'),
    ];
    if (seriesCol) encodings.push(enc(seriesCol.name, 'series'));

    const rationale = seriesCol
      ? `temporal × numeric → trend line (series: ${seriesCol.name} card ${seriesCol.cardinality})`
      : 'temporal × numeric → trend line';

    const dsl = makeDSL('line-1', 'line', `${numPrimary.name} over ${temporal.name}`, encodings);
    specs.push(dslToChartSpec(dsl, 'line', rationale, 1, alts, result, rows));
  }

  // Ranks 2a/2b — bar (and possibly donut/pie)
  if (categorical1 && numPrimary && rows.length > 0) {
    const card = categorical1.cardinality;

    if (card <= 30) {
      const shareAndSmall = card <= 8 && isShareColumn(numPrimary);
      const barAlts: string[] = shareAndSmall ? ['donut-2b'] : [];

      const barDsl = makeDSL(
        'bar-2', 'bar', `${numPrimary.name} by ${categorical1.name}`,
        [enc(categorical1.name, 'x'), enc(numPrimary.name, 'y', 'sum')],
        { limit: 30 },
      );
      const barRationale = card > 8
        ? `share column (${numPrimary.name}, card ${card} > 8) → bar only, no donut`
        : `categorical(${card}) × numeric → sorted bar`;
      specs.push(dslToChartSpec(barDsl, 'bar', barRationale, 2, barAlts, result, rows));

      // Donut (pie with inner radius) — only if card <= 8 AND isShareColumn
      if (shareAndSmall) {
        const pieDsl = makeDSL(
          'donut-2b', 'pie', `${numPrimary.name} share by ${categorical1.name}`,
          [enc(categorical1.name, 'x'), enc(numPrimary.name, 'y', 'sum')],
        );
        const pieRationale = `share column (${numPrimary.name}, card ${card} ≤ 8) → donut`;
        specs.push(dslToChartSpec(pieDsl, 'donut', pieRationale, 3, ['bar-2'], result, rows));
      }
    } else {
      // High cardinality — top 20 + Other rollup
      const barDsl = makeDSL(
        'bar-3', 'bar', `${numPrimary.name} by ${categorical1.name}`,
        [enc(categorical1.name, 'x'), enc(numPrimary.name, 'y', 'sum')],
        { limit: 20 },
      );
      const rollupRationale = `share column (${numPrimary.name}, card ${card} > 8) → bar only, no donut (top 20 + Other rollup)`;
      specs.push(dslToChartSpec(barDsl, 'bar', rollupRationale, 3, [], result, rows));
    }
  }

  // Rank 4 — scatter: 2 numeric columns, no temporal
  const numerics = usableProfiles.filter(
    p => p.kind === 'numeric_continuous' || p.kind === 'numeric_discrete'
  );
  if (numerics.length >= 2 && !temporal && rows.length > 0) {
    const colorCat = firstCategorical(usableProfiles, 6);
    const alts: string[] = [];
    if (categorical1 && numPrimary) alts.push('bar-2');

    const encodings: ChartEncoding[] = [
      enc(numerics[0].name, 'x'),
      enc(numerics[1].name, 'y'),
    ];
    if (colorCat) encodings.push(enc(colorCat.name, 'color'));

    const scatterDsl = makeDSL(
      'scatter-4', 'scatter', `${numerics[0].name} vs ${numerics[1].name}`, encodings,
    );
    const rationale = `2 numeric → scatter${colorCat ? ` (color: ${colorCat.name})` : ''}`;
    specs.push(dslToChartSpec(scatterDsl, 'scatter', rationale, 4, alts, result, rows));
  }

  // Rank 5 — heatmap: 2 categoricals + primary numeric
  const categoricals = usableProfiles.filter(p => p.kind === 'categorical');
  if (categoricals.length >= 2 && numPrimary) {
    const heatDsl = makeDSL(
      'heatmap-5', 'heatmap', `${numPrimary.name} by ${categoricals[0].name} × ${categoricals[1].name}`,
      [
        enc(categoricals[0].name, 'x'),
        enc(categoricals[1].name, 'y'),
        enc(numPrimary.name, 'value', 'sum'),
      ],
    );
    specs.push(dslToChartSpec(heatDsl, 'heatmap', '2 categoricals × numeric → heatmap (top 30×30)', 5, [], result, rows));
  }

  // Rank 6 — histogram: single numeric, no categorical, no temporal
  if (numPrimary && !temporal && categoricals.length === 0) {
    const histDsl = makeDSL(
      'histogram-6', 'histogram', `Distribution of ${numPrimary.name}`,
      [enc(numPrimary.name, 'x')],
    );
    const rationale = `single numeric, no categorical/temporal → histogram (Freedman–Diaconis)`;
    specs.push(dslToChartSpec(histDsl, 'histogram', rationale, 6, [], result, rows));
  }

  // Cross-spec alternatives
  const barSpec = specs.find(s => s.kind === 'bar');
  const scatterSpec = specs.find(s => s.kind === 'scatter');
  if (barSpec && scatterSpec) {
    (barSpec.alternatives as string[]).push(scatterSpec.id);
    (scatterSpec.alternatives as string[]).push(barSpec.id);
  }

  return specs.sort((a, b) => a.rank - b.rank);
}
