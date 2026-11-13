import 'server-only';

import prisma from '@/lib/db';
import { CURRENT_EMBEDDING_MODEL, embedQuery } from '@/lib/context/embed';
import {
  extractColumnNamesFromNativeSql,
  normalizeColumnKey,
  tokenOverlapScore,
} from '@/lib/powerbi/catalog-column-parse';
import {
  extractDaxColumnRefs,
  normalizePbiTableName,
  type DaxColumnRef,
  type TableUcRow,
} from '@/lib/powerbi/translate-dax-refs';

export type ColumnResolveVia =
  | 'pbi_source_column'
  | 'catalog_exact'
  | 'catalog_normalized'
  | 'native_sql'
  | 'semantic_token'
  | 'embed'
  | 'unmapped';

export type ResolvedDaxColumn = {
  table: string;
  pbi_column: string;
  warehouse_column: string | null;
  via: ColumnResolveVia;
  score?: number;
};

export type MeasureColumnResolution = {
  uc_full_path: string;
  context_object_id: string | null;
  allowed_columns: string[];
  dax_refs: ResolvedDaxColumn[];
  column_map: Record<string, string>;
  unmapped: string[];
  mapped_count: number;
  ref_count: number;
};

export type ModelColumnCatalog = {
  pbiColumnByTable: Map<string, Map<string, string | null>>;
  catalogNamesByObjectId: Map<string, string[]>;
  catalogNormIndex: Map<string, Map<string, string>>;
  nativeSqlColumnsByTable: Map<string, Set<string>>;
};

function resolveOneRef(
  ref: DaxColumnRef,
  tableKey: string,
  pbiCols: Map<string, string | null> | undefined,
  catalogNames: string[],
  normIndex: Map<string, string>,
  nativeCols: Set<string> | undefined,
): ResolvedDaxColumn {
  const pbi = ref.column;
  const sourceCol = pbiCols?.get(pbi) ?? pbiCols?.get(pbi.toLowerCase());
  if (sourceCol?.trim()) {
    return {
      table: ref.table,
      pbi_column: pbi,
      warehouse_column: sourceCol.trim(),
      via: 'pbi_source_column',
    };
  }

  if (catalogNames.includes(pbi)) {
    return {
      table: ref.table,
      pbi_column: pbi,
      warehouse_column: pbi,
      via: 'catalog_exact',
    };
  }

  const norm = normalizeColumnKey(pbi);
  const fromNorm = normIndex.get(norm);
  if (fromNorm) {
    return {
      table: ref.table,
      pbi_column: pbi,
      warehouse_column: fromNorm,
      via: 'catalog_normalized',
    };
  }

  if (nativeCols?.size) {
    for (const nc of nativeCols) {
      if (normalizeColumnKey(nc) === norm) {
        return {
          table: ref.table,
          pbi_column: pbi,
          warehouse_column: nc,
          via: 'native_sql',
        };
      }
    }
  }

  let best: { name: string; score: number } | null = null;
  for (const cn of catalogNames) {
    const score = tokenOverlapScore(pbi, cn);
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { name: cn, score };
    }
  }
  if (best) {
    return {
      table: ref.table,
      pbi_column: pbi,
      warehouse_column: best.name,
      via: 'semantic_token',
      score: best.score,
    };
  }

  return {
    table: ref.table,
    pbi_column: pbi,
    warehouse_column: null,
    via: 'unmapped',
  };
}

function parseVec(embedding: string | null): number[] | null {
  if (!embedding) return null;
  const inner = embedding.replace(/^\[|\]$/g, '');
  if (!inner.trim()) return null;
  return inner.split(',').map((x) => Number(x.trim()));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedResolveUnmapped(
  orgId: string,
  objectId: string,
  refs: ResolvedDaxColumn[],
): Promise<void> {
  if (process.env.PBI_COLUMN_RESOLVE_EMBED !== '1' && process.env.PBI_COLUMN_RESOLVE_EMBED !== 'true') {
    return;
  }
  const threshold = Number(process.env.PBI_COLUMN_RESOLVE_EMBED_MIN ?? '0.72') || 0.72;

  type EmbedRow = { subject_id: string; name: string; embedding: string | null };
  const rows = await prisma.$queryRaw<EmbedRow[]>`
    SELECT c.id::text AS subject_id, c.name, e.embedding::text AS embedding
    FROM platform_context_columns c
    JOIN platform_context_embeddings e
      ON e.subject_id = c.id AND e.subject_kind = 'column' AND e.org_id = ${orgId}
    WHERE c.org_id = ${orgId}
      AND c.object_id = ${objectId}::uuid
      AND c.lifecycle = 'active'
      AND e.embedding IS NOT NULL
      AND e.model_id = ${CURRENT_EMBEDDING_MODEL}
  `;
  if (rows.length === 0) return;

  const vecByColId = new Map(
    rows.map((r) => [r.subject_id, parseVec(r.embedding)] as const),
  );
  const nameByColId = new Map(rows.map((r) => [r.subject_id, r.name]));

  for (const ref of refs) {
    if (ref.via !== 'unmapped') continue;
    const queryText = `${ref.pbi_column} column`;
    const qVec = await embedQuery(queryText);
    if (!qVec) continue;

    let bestId: string | null = null;
    let bestScore = threshold;
    for (const [id, v] of vecByColId) {
      if (!v) continue;
      const sim = cosine(qVec, v);
      if (sim > bestScore) {
        bestScore = sim;
        bestId = id;
      }
    }
    if (bestId) {
      ref.warehouse_column = nameByColId.get(bestId) ?? null;
      ref.via = 'embed';
      ref.score = bestScore;
    }
  }
}

export async function loadModelColumnCatalog(
  orgId: string,
  internalModelId: string,
  tableRows: { name: string; nativeSql: string | null; contextObjectId: string | null }[],
): Promise<ModelColumnCatalog> {
  const pbiColumns = await prisma.pbiColumn.findMany({
    where: { org_id: orgId, model_id: internalModelId, lifecycle: 'active' },
    select: { name: true, source_column: true, table: { select: { name: true } } },
  });

  const pbiColumnByTable = new Map<string, Map<string, string | null>>();
  for (const c of pbiColumns) {
    const tKey = normalizePbiTableName(c.table.name).toLowerCase();
    let m = pbiColumnByTable.get(tKey);
    if (!m) {
      m = new Map();
      pbiColumnByTable.set(tKey, m);
    }
    m.set(c.name, c.source_column ?? null);
    m.set(c.name.toLowerCase(), c.source_column ?? null);
  }

  const objectIds = [
    ...new Set(tableRows.map((t) => t.contextObjectId).filter((id): id is string => Boolean(id))),
  ];

  const catalogNamesByObjectId = new Map<string, string[]>();
  const catalogNormIndex = new Map<string, Map<string, string>>();

  if (objectIds.length > 0) {
    const cols = await prisma.platformContextColumn.findMany({
      where: { org_id: orgId, object_id: { in: objectIds }, lifecycle: 'active' },
      select: { object_id: true, name: true, semantic: true },
    });
    for (const col of cols) {
      const bucket = catalogNamesByObjectId.get(col.object_id) ?? [];
      bucket.push(col.name);
      catalogNamesByObjectId.set(col.object_id, bucket);

      let normMap = catalogNormIndex.get(col.object_id);
      if (!normMap) {
        normMap = new Map();
        catalogNormIndex.set(col.object_id, normMap);
      }
      normMap.set(normalizeColumnKey(col.name), col.name);
      const sem = (col.semantic ?? {}) as Record<string, unknown>;
      const desc = typeof sem.description === 'string' ? sem.description : '';
      if (desc) {
        for (const token of desc.toLowerCase().split(/[^a-z0-9_]+/)) {
          if (token.length >= 4) normMap.set(normalizeColumnKey(token), col.name);
        }
      }
    }
  }

  const nativeSqlColumnsByTable = new Map<string, Set<string>>();
  for (const t of tableRows) {
    const key = normalizePbiTableName(t.name).toLowerCase();
    nativeSqlColumnsByTable.set(key, new Set(extractColumnNamesFromNativeSql(t.nativeSql)));
  }

  return {
    pbiColumnByTable,
    catalogNamesByObjectId,
    catalogNormIndex,
    nativeSqlColumnsByTable,
  };
}

export async function resolveMeasureColumnContext(input: {
  orgId: string;
  dax: string;
  ucFullPath: string;
  sourceTable: string;
  modelTables: Map<string, TableUcRow>;
  catalog: ModelColumnCatalog;
}): Promise<MeasureColumnResolution> {
  const refs = extractDaxColumnRefs(input.dax);
  const resolvedRefs: ResolvedDaxColumn[] = [];
  const columnMap: Record<string, string> = {};
  const allowed = new Set<string>();

  const primaryKey = normalizePbiTableName(input.sourceTable).toLowerCase();
  const primaryRow = input.modelTables.get(input.sourceTable) ??
    [...input.modelTables.entries()].find(
      ([k]) => normalizePbiTableName(k).toLowerCase() === primaryKey,
    )?.[1];

  const primaryObjectId = primaryRow?.contextObjectId ?? null;
  if (primaryObjectId) {
    for (const n of input.catalog.catalogNamesByObjectId.get(primaryObjectId) ?? []) {
      allowed.add(n);
    }
  }

  for (const ref of refs) {
    const tKey = normalizePbiTableName(ref.table).toLowerCase();
    const row =
      input.modelTables.get(ref.table) ??
      [...input.modelTables.entries()].find(
        ([k]) => normalizePbiTableName(k).toLowerCase() === tKey,
      )?.[1];
    const objectId = row?.contextObjectId ?? primaryObjectId;
    const catalogNames = objectId
      ? (input.catalog.catalogNamesByObjectId.get(objectId) ?? [])
      : [];
    if (objectId) {
      for (const n of catalogNames) allowed.add(n);
    }

    const r = resolveOneRef(
      ref,
      tKey,
      input.catalog.pbiColumnByTable.get(tKey),
      catalogNames,
      objectId ? (input.catalog.catalogNormIndex.get(objectId) ?? new Map()) : new Map(),
      input.catalog.nativeSqlColumnsByTable.get(tKey),
    );
    resolvedRefs.push(r);
    if (r.warehouse_column) {
      columnMap[r.pbi_column] = r.warehouse_column;
      allowed.add(r.warehouse_column);
    }
  }

  if (primaryObjectId) {
    await embedResolveUnmapped(input.orgId, primaryObjectId, resolvedRefs);
    for (const r of resolvedRefs) {
      if (r.warehouse_column && r.via === 'embed') {
        columnMap[r.pbi_column] = r.warehouse_column;
        allowed.add(r.warehouse_column);
      }
    }
  }

  const unmapped = resolvedRefs
    .filter((r) => !r.warehouse_column)
    .map((r) => `${r.table}[${r.pbi_column}]`);
  const mappedCount = resolvedRefs.filter((r) => r.warehouse_column).length;

  return {
    uc_full_path: input.ucFullPath,
    context_object_id: primaryObjectId,
    allowed_columns: [...allowed].sort(),
    dax_refs: resolvedRefs,
    column_map: columnMap,
    unmapped,
    mapped_count: mappedCount,
    ref_count: refs.length,
  };
}

export function columnResolutionProps(
  resolution: MeasureColumnResolution,
): Record<string, unknown> {
  return {
    column_resolution: {
      mapped_count: resolution.mapped_count,
      ref_count: resolution.ref_count,
      unmapped: resolution.unmapped,
      column_map: resolution.column_map,
      allowed_columns_count: resolution.allowed_columns.length,
      context_object_id: resolution.context_object_id,
      dax_refs: resolution.dax_refs.map((r) => ({
        table: r.table,
        pbi_column: r.pbi_column,
        warehouse_column: r.warehouse_column,
        via: r.via,
        score: r.score,
      })),
    },
  };
}
