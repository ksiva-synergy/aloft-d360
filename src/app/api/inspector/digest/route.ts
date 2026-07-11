import { NextRequest, NextResponse } from 'next/server';
import { getDefaultOrg } from '@/lib/platform/agents';
import { assembleDigest, renderDigestNarrative } from '@/lib/inspector/digest';
import type { T4DigestPayload } from '@/lib/inspector/digest';
import type { ChartDSLSpec } from '@/lib/studio/chart-dsl';
import type { ProfileResult } from '@/lib/studio/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/digest?runId=<optional>
 *
 * Returns the T4DigestPayload for the most recent (or specified) succeeded
 * t4_scan run, a rendered markdown narrative, and chart packages.
 *
 * Each chart package contains:
 *   - spec: ChartDSLSpec — the encoding description
 *   - rows: Record<string, unknown>[] — the pre-derived data rows
 *   - profile: ProfileResult — synthetic column metadata
 *
 * These three together are the exact inputs compileSpecToOption(spec, profile, rows)
 * and renderSpecToPng(spec, profile, rows) require. No consumer needs to
 * re-derive data from payload to render a chart.
 *
 * This route does NOT import ssr-render.ts — readFileSync at module init
 * breaks Vercel serverless. ssr-render.ts is the Fargate-only consumer.
 *
 * Returns 404 if no succeeded t4_scan exists for this org.
 */
export async function GET(req: NextRequest) {
  try {
    const org = await getDefaultOrg();
    const runId = req.nextUrl.searchParams.get('runId') ?? undefined;

    const payload = await assembleDigest(org.id, runId);

    if (!payload) {
      return NextResponse.json(
        { error: 'No succeeded t4_scan run found for this org' },
        { status: 404 },
      );
    }

    const narrative = renderDigestNarrative(payload);
    const charts = buildDigestCharts(payload);

    return NextResponse.json({ payload, narrative, charts });
  } catch (err) {
    console.error('[inspector/digest GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── Chart packages ────────────────────────────────────────────────────────────
//
// compileSpecToOption(spec, profile, rows) and renderSpecToPng(spec, profile, rows)
// both require three inputs. Returning spec alone is not enough — the consumer
// would still need to reshape payload.clusters into rows and construct a profile.
// We pre-derive both here so the response is self-contained for any renderer.
//
// Columns used (synthetic — not Databricks columns):
//   Chart 1 (bar):         cluster (categorical), entity_count (numeric_discrete)
//   Chart 2 (stacked-bar): cluster (categorical), count (numeric_discrete),
//                          definition_type (categorical, values: dims | measures)

export interface DigestChartPackage {
  spec: ChartDSLSpec;
  rows: Record<string, unknown>[];
  profile: ProfileResult;
}

function buildDigestCharts(payload: T4DigestPayload): DigestChartPackage[] {
  if (payload.clusters.length === 0) return [];

  // ── Chart 1: Entities per cluster ─────────────────────────────────────────
  const entityRows: Record<string, unknown>[] = payload.clusters.map((c) => ({
    cluster: `${c.catalog}.${c.schema}`,
    entity_count: c.entities.length,
  }));

  const entitySpec: ChartDSLSpec = {
    id: `t4-digest-entities-${payload.runId}`,
    kind: 'bar',
    title: 'Entities Proposed by Schema Cluster',
    subtitle: `Run: ${new Date(payload.startedAt).toUTCString()}`,
    encodings: [
      { columnId: 'cluster', role: 'x' },
      { columnId: 'entity_count', role: 'y', aggregate: 'none' },
    ],
    sort: { columnId: 'entity_count', direction: 'desc' },
    themeSlot: 'aloft-dark',
  };

  const entityProfile: ProfileResult = {
    profiles: [
      {
        name: 'cluster',
        declaredType: 'STRING',
        kind: 'categorical',
        cardinality: entityRows.length,
        nullRate: 0,
        topValues: entityRows.map((r) => ({ value: String(r.cluster), count: 1 })),
      },
      {
        name: 'entity_count',
        declaredType: 'LONG',
        kind: 'numeric_discrete',
        cardinality: entityRows.length,
        nullRate: 0,
        min: Math.min(...entityRows.map((r) => Number(r.entity_count))),
        max: Math.max(...entityRows.map((r) => Number(r.entity_count))),
      },
    ],
    columnsTruncated: false,
    rowsSampled: entityRows.length,
  };

  const charts: DigestChartPackage[] = [
    { spec: entitySpec, rows: entityRows, profile: entityProfile },
  ];

  // ── Chart 2: Dims + measures stacked per cluster ───────────────────────────
  // Only emit if at least one cluster has dimensions or measures
  const hasDefinitions = payload.clusters.some(
    (c) => c.entities.some((e) => e.dimensionCount > 0 || e.measureCount > 0),
  );

  if (hasDefinitions) {
    const defRows: Record<string, unknown>[] = payload.clusters.flatMap((c) => {
      const clusterKey = `${c.catalog}.${c.schema}`;
      const dims = c.entities.reduce((s, e) => s + e.dimensionCount, 0);
      const measures = c.entities.reduce((s, e) => s + e.measureCount, 0);
      return [
        { cluster: clusterKey, count: dims, definition_type: 'dims' },
        { cluster: clusterKey, count: measures, definition_type: 'measures' },
      ];
    });

    const clusterValues = [...new Set(defRows.map((r) => String(r.cluster)))];

    const defSpec: ChartDSLSpec = {
      id: `t4-digest-definitions-${payload.runId}`,
      kind: 'stacked-bar',
      title: 'Definitions Proposed by Schema Cluster',
      subtitle: 'Dimensions and measures',
      encodings: [
        { columnId: 'cluster', role: 'x' },
        { columnId: 'count', role: 'y', aggregate: 'none' },
        { columnId: 'definition_type', role: 'series' },
      ],
      themeSlot: 'aloft-dark',
    };

    const defProfile: ProfileResult = {
      profiles: [
        {
          name: 'cluster',
          declaredType: 'STRING',
          kind: 'categorical',
          cardinality: clusterValues.length,
          nullRate: 0,
          topValues: clusterValues.map((v) => ({ value: v, count: 1 })),
        },
        {
          name: 'count',
          declaredType: 'LONG',
          kind: 'numeric_discrete',
          cardinality: defRows.length,
          nullRate: 0,
          min: Math.min(...defRows.map((r) => Number(r.count))),
          max: Math.max(...defRows.map((r) => Number(r.count))),
        },
        {
          name: 'definition_type',
          declaredType: 'STRING',
          kind: 'categorical',
          cardinality: 2,
          nullRate: 0,
          topValues: [
            { value: 'dims', count: 1 },
            { value: 'measures', count: 1 },
          ],
        },
      ],
      columnsTruncated: false,
      rowsSampled: defRows.length,
    };

    charts.push({ spec: defSpec, rows: defRows, profile: defProfile });
  }

  return charts;
}
