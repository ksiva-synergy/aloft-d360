import 'server-only';
import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';
import { SQL_OBJECT_HAS_EMBEDDING } from '@/lib/context/embedding-presence';

export interface PipelineHealth {
  source_id: string | null;
  discovery_objects: number;
  scanned_objects: number;
  profiled_objects: number;
  enriched_objects: number;
  embedded_objects: number;
  discovery_not_scanned: number;
  needs_profile: number;
  needs_enrich: number;
  needs_embed: number;
}

export type RecommendationAction =
  | 'estate_inventory'
  | 't0_structural'
  | 't1_profile'
  | 't2_semantic'
  | 'embed'
  | 't3_usage';

export interface JobRecommendation {
  action: RecommendationAction;
  title: string;
  detail: string;
  kinds: string[];
  sequential: boolean;
  includePatterns: string[];
  estimatedTables: number;
  sampleSchemas: string[];
}

function srcEstate(sourceId?: string): Prisma.Sql {
  return sourceId ? Prisma.sql`AND peo.source_id = ${sourceId}` : Prisma.empty;
}

function srcPco(sourceId?: string): Prisma.Sql {
  return sourceId ? Prisma.sql`AND o.source_id = ${sourceId}::uuid` : Prisma.empty;
}

export async function getPipelineHealth(orgId: string, sourceId?: string): Promise<PipelineHealth> {
  const [discoveryRow, scannedRow, tierRow, embedRow, gapRow] = await Promise.all([
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM platform_estate_objects peo
      WHERE peo.org_id = ${orgId} AND peo.lifecycle = 'active' ${srcEstate(sourceId)}
    `),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM platform_context_objects o
      WHERE o.org_id = ${orgId} AND o.lifecycle = 'active' ${srcPco(sourceId)}
    `),
    prisma.$queryRaw<
      Array<{ profiled: number; enriched: number; needs_profile: number; needs_enrich: number }>
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE o.last_t1_at IS NOT NULL)::int AS profiled,
        COUNT(*) FILTER (WHERE o.last_t2_at IS NOT NULL)::int AS enriched,
        COUNT(*) FILTER (WHERE o.last_t1_at IS NULL OR o.last_t0_at IS NULL OR o.last_t1_at < o.last_t0_at)::int AS needs_profile,
        COUNT(*) FILTER (WHERE o.last_t2_at IS NULL OR o.last_t1_at IS NULL OR o.last_t2_at < o.last_t1_at)::int AS needs_enrich
      FROM platform_context_objects o
      WHERE o.org_id = ${orgId} AND o.lifecycle = 'active' ${srcPco(sourceId)}
    `),
    prisma.$queryRaw<Array<{ embedded: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS embedded FROM platform_context_objects o
      WHERE o.org_id = ${orgId} AND o.lifecycle = 'active' ${srcPco(sourceId)}
        AND ${SQL_OBJECT_HAS_EMBEDDING}
    `),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM platform_estate_objects peo
      LEFT JOIN platform_context_objects pco
        ON pco.org_id = peo.org_id AND pco.full_path = peo.full_path AND pco.lifecycle = 'active'
      WHERE peo.org_id = ${orgId} AND peo.lifecycle = 'active' ${srcEstate(sourceId)}
        AND pco.id IS NULL
    `),
  ]);

  const scanned = scannedRow[0]?.n ?? 0;
  const embedded = embedRow[0]?.embedded ?? 0;
  const tier = tierRow[0];

  return {
    source_id: sourceId ?? null,
    discovery_objects: discoveryRow[0]?.n ?? 0,
    scanned_objects: scanned,
    profiled_objects: tier?.profiled ?? 0,
    enriched_objects: tier?.enriched ?? 0,
    embedded_objects: embedded,
    discovery_not_scanned: gapRow[0]?.n ?? 0,
    needs_profile: tier?.needs_profile ?? 0,
    needs_enrich: tier?.needs_enrich ?? 0,
    needs_embed: Math.max(0, scanned - embedded),
  };
}

async function topUnscannedSchemas(
  orgId: string,
  sourceId?: string,
  limit = 3,
): Promise<Array<{ key: string; tables: number }>> {
  const rows = await prisma.$queryRaw<Array<{ catalog_name: string; schema_name: string; tables: number }>>(
    Prisma.sql`
      SELECT peo.catalog_name, peo.schema_name, COUNT(*)::int AS tables
      FROM platform_estate_objects peo
      LEFT JOIN platform_context_objects pco
        ON pco.org_id = peo.org_id AND pco.full_path = peo.full_path AND pco.lifecycle = 'active'
      WHERE peo.org_id = ${orgId} AND peo.lifecycle = 'active' ${srcEstate(sourceId)}
        AND pco.id IS NULL
      GROUP BY peo.catalog_name, peo.schema_name
      ORDER BY tables DESC
      LIMIT ${limit}
    `,
  );
  return rows.map(r => ({
    key: `${r.catalog_name}.${r.schema_name}`,
    tables: r.tables,
  }));
}

export async function getJobRecommendations(
  orgId: string,
  sourceId?: string,
): Promise<{ primary: JobRecommendation | null; health: PipelineHealth }> {
  const health = await getPipelineHealth(orgId, sourceId);
  const sampleSchemas = (await topUnscannedSchemas(orgId, sourceId)).map(s => s.key);
  const schemaPatterns = sampleSchemas.map(k => `${k}.*`);

  if (health.discovery_objects === 0) {
    return {
      health,
      primary: {
        action: 'estate_inventory',
        title: 'Refresh discovery',
        detail: 'No discovery rows yet — run estate inventory before structural scan.',
        kinds: ['estate_inventory'],
        sequential: false,
        includePatterns: [],
        estimatedTables: 0,
        sampleSchemas: [],
      },
    };
  }

  if (health.discovery_not_scanned > 0) {
    const est = health.discovery_not_scanned;
    return {
      health,
      primary: {
        action: 't0_structural',
        title: `Structural scan on ${est.toLocaleString()} discovery table${est !== 1 ? 's' : ''}`,
        detail: sampleSchemas.length
          ? `Scans the ${sampleSchemas.length} largest unscanned schema${sampleSchemas.length !== 1 ? 's' : ''} first (structural scan, T0).`
          : 'Tables exist in discovery but are not scanned yet.',
        kinds: ['t0_structural'],
        sequential: false,
        includePatterns: schemaPatterns,
        estimatedTables: est,
        sampleSchemas,
      },
    };
  }

  if (health.needs_profile > 0) {
    return {
      health,
      primary: {
        action: 't1_profile',
        title: `Profile ${health.needs_profile.toLocaleString()} scanned table${health.needs_profile !== 1 ? 's' : ''}`,
        detail: 'Stale or never profiled after the last structural scan.',
        kinds: ['t1_profile'],
        sequential: false,
        includePatterns: [],
        estimatedTables: health.needs_profile,
        sampleSchemas: [],
      },
    };
  }

  if (health.needs_enrich > 0) {
    return {
      health,
      primary: {
        action: 't2_semantic',
        title: `Enrich ${health.needs_enrich.toLocaleString()} profiled table${health.needs_enrich !== 1 ? 's' : ''}`,
        detail: 'Semantic cards missing or older than latest profile.',
        kinds: ['t2_semantic'],
        sequential: false,
        includePatterns: [],
        estimatedTables: health.needs_enrich,
        sampleSchemas: [],
      },
    };
  }

  if (health.needs_embed > 0) {
    return {
      health,
      primary: {
        action: 'embed',
        title: `Embed ${health.needs_embed.toLocaleString()} table${health.needs_embed !== 1 ? 's' : ''}`,
        detail: 'Vector embeddings missing for catalog search.',
        kinds: ['embed'],
        sequential: false,
        includePatterns: [],
        estimatedTables: health.needs_embed,
        sampleSchemas: [],
      },
    };
  }

  return {
    health,
    primary: {
      action: 't3_usage',
      title: 'Refresh usage (T3)',
      detail: 'Pipeline tiers are current — optional warehouse query-history harvest.',
      kinds: ['t3_usage'],
      sequential: false,
      includePatterns: [],
      estimatedTables: health.scanned_objects,
      sampleSchemas: [],
    },
  };
}
