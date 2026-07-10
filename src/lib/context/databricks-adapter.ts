import 'server-only';

import { executeDatabricksSQL, DATABRICKS_API_MAX_WAIT_SECS } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';
import type {
  ContextSource,
  ObjectRef,
  StructuralMetadata,
  ObjectProfile,
  ProfileBudget,
} from './types';
import { EstateRowSchema, buildFullPath } from './types';
import type { EstateRow } from './types';
import type { AdapterCapabilities, ContextHarvestAdapter, HarvestStructureOpts } from './adapter';
import { NotImplementedError } from './adapter';

// minimatch and the include/exclude predicate are imported from scope-match.ts
// so deepScan.ts (sentinel runtime, cannot use server-only) can share the
// identical matching logic without a second implementation.
import { minimatch, matchesScope, catalogMatchesIncludes } from './scope-match';

// ── Identifier safety ─────────────────────────────────────────────────────────

function safeId(id: string, label: string): string {
  if (/[`\\]/.test(id)) throw new Error(`Unsafe identifier in ${label}: "${id}"`);
  return id;
}

function safeSqlStr(val: string, label: string): string {
  if (/[\\;]/.test(val)) throw new Error(`Unsafe value in ${label}: "${val}"`);
  // Escape single quotes by doubling them (standard SQL escaping)
  return val.replace(/'/g, "''");
}

// ── Connection meta ───────────────────────────────────────────────────────────

export interface DatabricksConnMeta {
  id: string;
  workspace_host: string;
  default_warehouse_id: string;
}

// ── Raw query history row ─────────────────────────────────────────────────────

export interface RawHistoryRow {
  statement_text: string | null;
  executed_as: string | null;
  start_time: string | null;
  update_time: string | null;
  query_source: unknown;
  produced_rows: number | null;
}

// ── Raw lineage rows ──────────────────────────────────────────────────────────

export interface RawTableLineageRow {
  source_table_full_name: string | null;
  target_table_full_name: string | null;
}

export interface RawColumnLineageRow {
  source_table_full_name: string | null;
  source_column_name: string | null;
  target_table_full_name: string | null;
  target_column_name: string | null;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class DatabricksAdapter implements ContextHarvestAdapter {
  readonly kind = 'databricks' as const;
  private _queryCount = 0;
  get queryCount(): number { return this._queryCount; }

  constructor(private readonly conn: DatabricksConnMeta) {}

  capabilities(): AdapterCapabilities {
    return { changeDetection: true, nativeStats: true, sampling: true };
  }

  // ── resolveScope ────────────────────────────────────────────────────────────
  // Queries: 1 (SHOW CATALOGS) + 1 per candidate catalog

  async resolveScope(source: ContextSource): Promise<ObjectRef[]> {
    const includes = source.scope_include ?? ['*.*.*'];
    const excludes = source.scope_exclude ?? [];

    // 1. SHOW CATALOGS — enumerate all catalogs visible to the token
    const catalogResult = await this.scopeExec('SHOW CATALOGS');
    const allCatalogs = catalogResult.rows
      .map(r => String(r['catalog'] ?? r['databaseName'] ?? ''))
      .filter(Boolean);

    // Keep only catalogs that could satisfy the first segment of any include pattern
    const candidateCatalogs = allCatalogs.filter(cat =>
      catalogMatchesIncludes(cat, includes)
    );

    const refs: ObjectRef[] = [];

    for (const catalog of candidateCatalogs) {
      const catSafe = safeId(catalog, 'catalog');

      const candidateSchemas = includes
        .filter(pat => catalogMatchesIncludes(catalog, [pat]))
        .map(pat => pat.split('.')[1] || '*');

      const hasWildcardSchema = candidateSchemas.some(sch => sch.includes('*') || sch.includes('?'));
      let schemaFilter = `table_schema NOT IN ('information_schema')`;
      if (!hasWildcardSchema && candidateSchemas.length > 0) {
        const schemaList = candidateSchemas.map(sch => `'${safeSqlStr(sch, 'schema')}'`).join(', ');
        schemaFilter += ` AND table_schema IN (${schemaList})`;
      }

      let tableResult;
      try {
        tableResult = await this.scopeExec(
          `SELECT table_catalog, table_schema, table_name ` +
          `FROM \`${catSafe}\`.information_schema.tables ` +
          `WHERE ${schemaFilter}`
        );
      } catch (e) {
        console.warn(`resolveScope: skipping catalog ${catalog}:`, e instanceof Error ? e.message : String(e));
        continue;
      }

      for (const row of tableResult.rows) {
        const cat = String(row['table_catalog'] ?? catalog);
        const sch = String(row['table_schema'] ?? '');
        const tbl = String(row['table_name'] ?? '');
        if (!sch || !tbl) continue;

        const fullPath = buildFullPath(cat, sch, tbl);
        if (matchesScope(fullPath, includes, excludes)) {
          refs.push({
            source_id: source.id,
            connection_id: source.connection_ref,
            full_path: fullPath,
            catalog_name: cat.trim().toLowerCase(),
            schema_name: sch.trim().toLowerCase(),
            object_name: tbl.trim().toLowerCase(),
          });
        }
      }
    }

    return refs;
  }

  // ── detectChanges ───────────────────────────────────────────────────────────
  // Queries: 1 (system.information_schema.tables) — falls back to resolveScope on error

  async detectChanges(source: ContextSource, since: Date): Promise<ObjectRef[]> {
    const sinceIso = since.toISOString();
    let rows: Record<string, unknown>[];

    try {
      const result = await this.scopeExec(
        `SELECT table_catalog, table_schema, table_name ` +
        `FROM system.information_schema.tables ` +
        `WHERE last_altered > '${sinceIso}'`
      );
      rows = result.rows;
    } catch {
      // system.information_schema.tables unavailable (non-Unity or insufficient privs)
      // Fall back to full scope sweep so the caller treats all refs as changed.
      return this.resolveScope(source);
    }

    const includes = source.scope_include ?? ['*.*.*'];
    const excludes = source.scope_exclude ?? [];

    return rows
      .map(row => {
        const cat = String(row['table_catalog'] ?? '');
        const sch = String(row['table_schema'] ?? '');
        const tbl = String(row['table_name'] ?? '');
        return {
          source_id: source.id,
          connection_id: source.connection_ref,
          full_path: buildFullPath(cat, sch, tbl),
          catalog_name: cat.trim().toLowerCase(),
          schema_name: sch.trim().toLowerCase(),
          object_name: tbl.trim().toLowerCase(),
        } satisfies ObjectRef;
      })
      .filter(ref =>
        matchesScope(ref.full_path, includes, excludes)
      );
  }

  // ── harvestStructure ────────────────────────────────────────────────────────
  // Queries: 2 per (catalog, schema) group + per-table fallback if batch truncated.
  // last_altered fetched from information_schema.tables; if the column is absent
  // (non-Unity catalog) the first query fails and we retry without it.

  async harvestStructure(
    refs: ObjectRef[],
    opts?: HarvestStructureOpts,
  ): Promise<StructuralMetadata[]> {
    if (refs.length === 0) return [];

    const budgetCap = opts?.queryBudget ?? Infinity;
    let queriesIssued = 0;

    // Group refs by (catalog \0 schema) so we batch by information_schema boundary
    const groups = new Map<string, ObjectRef[]>();
    for (const ref of refs) {
      const key = `${ref.catalog_name}\x00${ref.schema_name}`;
      const g = groups.get(key);
      if (g) g.push(ref);
      else groups.set(key, [ref]);
    }

    const results: StructuralMetadata[] = [];

    // Max tables per Databricks query — keeps IN-list size and result sets manageable.
    const CHUNK_SIZE = 200;

    for (const groupRefs of groups.values()) {
      if (queriesIssued >= budgetCap) break;

      const { catalog_name: catalog, schema_name: schema } = groupRefs[0];
      const catSafe = safeId(catalog, 'catalog');
      const schSafe = safeSqlStr(schema, 'schema');

      type TableMeta = { object_kind: string; native_comment: string | null; source_altered_at: Date | null };
      const tableMeta = new Map<string, TableMeta>();
      const colsByTable = new Map<string, Record<string, unknown>[]>();

      const buildTableMeta = (rows: Record<string, unknown>[], hasAlteredCol: boolean) => {
        for (const row of rows) {
          const n = String(row['table_name'] ?? '');
          if (!n) continue;
          const raw = String(row['table_type'] ?? '').toUpperCase();
          tableMeta.set(n, {
            object_kind: raw === 'VIEW' ? 'view' : raw === 'MATERIALIZED_VIEW' ? 'materialized_view' : 'table',
            native_comment: row['comment'] ? String(row['comment']) : null,
            source_altered_at: hasAlteredCol && row['last_altered']
              ? new Date(String(row['last_altered']))
              : null,
          });
        }
      };

      // Process refs in chunks so no single query has an unbounded IN-list
      for (let chunkStart = 0; chunkStart < groupRefs.length; chunkStart += CHUNK_SIZE) {
        if (queriesIssued >= budgetCap) break;

        const chunk = groupRefs.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkNum = Math.floor(chunkStart / CHUNK_SIZE) + 1;
        const totalChunks = Math.ceil(groupRefs.length / CHUNK_SIZE);
        console.log(`[t0_structural] ${schema} chunk ${chunkNum}/${totalChunks} (${chunk.length} tables, ${chunkStart + chunk.length}/${groupRefs.length} total)`);

        const tableIn = chunk.map(r => `'${safeSqlStr(r.object_name, 'table')}'`).join(', ');

        // ── Query 1: table type + comment + last_altered ──────────────────────
        try {
          const r = await this.exec(
            `SELECT table_name, table_type, comment, last_altered ` +
            `FROM \`${catSafe}\`.information_schema.tables ` +
            `WHERE table_schema = '${schSafe}' AND table_name IN (${tableIn})`
          );
          queriesIssued++;
          buildTableMeta(r.rows, true);
        } catch {
          // last_altered column absent — retry without it
          try {
            const r = await this.exec(
              `SELECT table_name, table_type, comment ` +
              `FROM \`${catSafe}\`.information_schema.tables ` +
              `WHERE table_schema = '${schSafe}' AND table_name IN (${tableIn})`
            );
            queriesIssued++;
            buildTableMeta(r.rows, false);
          } catch (e2) {
            // information_schema unavailable for this catalog (e.g. non-Unity, no perms)
            // Skip the whole group rather than failing the entire job.
            console.warn(`harvestStructure: skipping catalog ${catalog}.${schema} — ${e2 instanceof Error ? e2.message.slice(0, 120) : String(e2)}`);
            break;
          }
        }

        if (queriesIssued >= budgetCap) break;

        // ── Query 2: columns for this chunk ──────────────────────────────────
        const colResult = await this.exec(
          `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, comment ` +
          `FROM \`${catSafe}\`.information_schema.columns ` +
          `WHERE table_schema = '${schSafe}' AND table_name IN (${tableIn}) ` +
          `ORDER BY table_name, ordinal_position`
        );
        queriesIssued++;

        for (const row of colResult.rows) {
          const n = String(row['table_name'] ?? '');
          const arr = colsByTable.get(n);
          if (arr) arr.push(row);
          else colsByTable.set(n, [row]);
        }

        // If the row cap truncated the batch, fall back to per-table column queries
        if (colResult.truncated) {
          for (const ref of chunk) {
            if (!colsByTable.has(ref.object_name) && queriesIssued < budgetCap) {
              const tblSafe = safeId(ref.object_name, 'table');
              const perTable = await this.exec(
                `SELECT column_name, ordinal_position, data_type, is_nullable, comment ` +
                `FROM \`${catSafe}\`.information_schema.columns ` +
                `WHERE table_schema = '${schSafe}' AND table_name = '${safeSqlStr(ref.object_name, 'table')}' ` +
                `ORDER BY ordinal_position`
              );
              queriesIssued++;
              colsByTable.set(
                ref.object_name,
                perTable.rows.map(r => ({ ...r, table_name: tblSafe })),
              );
            }
          }
        }
      } // end chunk loop

      if (queriesIssued >= budgetCap) break;

      // ── Assemble StructuralMetadata for each ref ───────────────────────────
      for (const ref of groupRefs) {
        const meta = tableMeta.get(ref.object_name);
        const colRows = colsByTable.get(ref.object_name) ?? [];

        results.push({
          ref,
          object_kind: meta?.object_kind ?? 'table',
          native_comment: meta?.native_comment ?? null,
          source_altered_at: meta?.source_altered_at ?? null,
          columns: colRows.map(row => ({
            name: String(row['column_name'] ?? ''),
            ordinal: Number(row['ordinal_position'] ?? 0),
            data_type: String(row['data_type'] ?? ''),
            is_nullable: String(row['is_nullable'] ?? 'YES').toUpperCase() !== 'NO',
            native_comment: row['comment'] ? String(row['comment']) : null,
          })),
        });
      }
    }

    return results;
  }

  // ── harvestProfile ──────────────────────────────────────────────────────────

  async harvestProfile(ref: ObjectRef, budget: ProfileBudget): Promise<ObjectProfile> {
    const catSafe = safeId(ref.catalog_name, 'catalog');
    const schSafe = safeSqlStr(ref.schema_name, 'schema');
    const tblSafe = safeSqlStr(ref.object_name, 'table');

    let cols = budget.columns;
    let statementCount = 0;

    // 1. Fetch columns if not supplied in budget and statement budget allows
    if (!cols) {
      if (statementCount >= budget.maxStatements) {
        throw new Error(`Query budget exceeded before fetching columns for ${ref.full_path}`);
      }
      const columnsResult = await this.exec(
        `SELECT column_name, data_type, is_nullable ` +
        `FROM \`${catSafe}\`.information_schema.columns ` +
        `WHERE table_schema = '${schSafe}' AND table_name = '${tblSafe}' ` +
        `ORDER BY ordinal_position`
      );
      statementCount++;

      cols = columnsResult.rows.map(row => ({
        name: String(row['column_name'] ?? ''),
        data_type: String(row['data_type'] ?? ''),
        is_nullable: String(row['is_nullable'] ?? 'YES').toUpperCase() !== 'NO',
      }));
    }

    if (!cols || cols.length === 0) {
      throw new Error(`No columns available to profile for table/view: ${ref.full_path}`);
    }

    // 2. Fetch metadata (DESCRIBE DETAIL) if budget allows (takes 1 query)
    let sizeBytes: number | null = null;
    let tableFormat: string | null = null;
    if (statementCount < budget.maxStatements) {
      try {
        const detailResult = await this.exec(`DESCRIBE DETAIL \`${catSafe}\`.\`${schSafe}\`.\`${tblSafe}\``);
        statementCount++;
        if (detailResult.rows.length > 0) {
          const row = detailResult.rows[0];
          sizeBytes = row.sizeInBytes !== null && row.sizeInBytes !== undefined ? Number(row.sizeInBytes) : null;
          tableFormat = row.format ? String(row.format) : null;
        }
      } catch (e) {
        // Catch view/materialized view errors, or permission issues
        console.log(`DESCRIBE DETAIL failed for ${ref.full_path}:`, e instanceof Error ? e.message : String(e));
      }
    }

    // 3. Compile the main SELECT query of aggregates (takes 1 query)
    if (statementCount >= budget.maxStatements) {
      // Budget exhausted after DESCRIBE DETAIL — return partial profile with what we have
      return {
        ref,
        capturedAt: new Date(),
        stats: {
          row_count: null,
          size_bytes: sizeBytes,
          is_sampled: false,
          sample_pct: 100,
          query_count: statementCount,
          partial: true,
          columns: {},
        },
      };
    }

    const { rowLimit, useSubquery, effectiveRows, avgRowBytes } = resolveProfileWindow(
      sizeBytes,
      budget.estimatedRows,
    );
    const columnModes = classifyProfileColumns(cols, avgRowBytes);

    const selectItems: string[] = ['COUNT(*) AS \`__row_count\`'];
    const subqueryColumns: string[] = [];

    for (const col of cols) {
      const mode = columnModes.get(col.name)?.mode ?? 'full';
      if (mode === 'skipped') continue;

      const colSafe = safeId(col.name, 'column');
      const colEscaped = `\`${colSafe}\``;
      subqueryColumns.push(colEscaped);

      selectItems.push(`SUM(CASE WHEN ${colEscaped} IS NULL THEN 1 ELSE 0 END) AS \`${colSafe}_null_cnt\``);

      if (mode === 'full' && !isComplexType(col.data_type)) {
        selectItems.push(`APPROX_COUNT_DISTINCT(${colEscaped}) AS \`${colSafe}_distinct_cnt\``);

        const colWrapped = isWideStringType(col.data_type)
          ? `SUBSTRING(${colEscaped}, 1, 255)`
          : colEscaped;

        // Databricks rejects APPROX_TOP_K on timestamp/date/binary — see DATATYPE_MISMATCH 42K09
        if (!isUnsupportedTopKType(col.data_type)) {
          selectItems.push(`APPROX_TOP_K(${colWrapped}, 5) AS \`${colSafe}_top_k\``);
        }

        if (!isBooleanType(col.data_type)) {
          selectItems.push(`MIN(${colWrapped}) AS \`${colSafe}_min\``);
          selectItems.push(`MAX(${colWrapped}) AS \`${colSafe}_max\``);
        }
      }
    }

    const skippedNotes: Record<string, { data_type: string; reason: string }> = {};
    for (const col of cols) {
      const entry = columnModes.get(col.name);
      if (entry?.mode === 'skipped' && entry.skipReason) {
        skippedNotes[col.name] = { data_type: col.data_type, reason: entry.skipReason };
      }
    }

    if (useSubquery && subqueryColumns.length === 0) {
      console.log(`  -> all ${cols.length} columns skipped as heavy; returning metadata-only profile`);
      const columnsProfile: Record<string, unknown> = {};
      for (const col of cols) {
        columnsProfile[col.name] = {
          data_type: col.data_type,
          skipped: true,
          skip_reason: columnModes.get(col.name)?.skipReason ?? 'heavy_column_type',
        };
      }
      return {
        ref,
        capturedAt: new Date(),
        stats: {
          row_count: null,
          size_bytes: sizeBytes,
          is_sampled: false,
          profile_window_rows: null,
          sample_pct: 100,
          query_count: statementCount,
          partial: true,
          skipped_columns: skippedNotes,
          columns: columnsProfile,
        },
      };
    }

    const fromClause = useSubquery
      ? `(SELECT ${subqueryColumns.join(', ')} FROM \`${catSafe}\`.\`${schSafe}\`.\`${tblSafe}\` LIMIT ${rowLimit})`
      : `\`${catSafe}\`.\`${schSafe}\`.\`${tblSafe}\``;

    const query = `SELECT ${selectItems.join(', ')} FROM ${fromClause}`;

    console.log(
      `  -> sizeBytes: ${sizeBytes}, effectiveRows: ${effectiveRows}, avgRowBytes: ${avgRowBytes ?? 'n/a'}, ` +
      `window: ${useSubquery ? rowLimit : 'full'}, profiledCols: ${subqueryColumns.length}/${cols.length}, ` +
      `skipped: ${Object.keys(skippedNotes).length}`,
    );
    console.log(`  -> executing query: ${query.substring(0, 200)}...`);

    let queryResult: { rows: Record<string, unknown>[] };
    try {
      queryResult = await this.exec(query);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isView = budget.objectKind === 'view' || budget.objectKind === 'materialized_view';
      if (!isView) throw e;

      console.log(`Profile query failed for view ${ref.full_path}; metadata-only partial: ${msg}`);
      const columnsProfile: Record<string, unknown> = {};
      for (const col of cols) {
        columnsProfile[col.name] = {
          data_type: col.data_type,
          skipped: true,
          skip_reason: 'view_query_failed',
        };
      }
      return {
        ref,
        capturedAt: new Date(),
        stats: {
          row_count: null,
          size_bytes: sizeBytes,
          is_sampled: false,
          sample_pct: 100,
          query_count: statementCount,
          partial: true,
          view_unqueryable: true,
          query_error: msg.slice(0, 500),
          skipped_columns: skippedNotes,
          columns: columnsProfile,
        },
      };
    }
    statementCount++;

    const resultRow = queryResult.rows[0] ?? {};
    const rawRowCount = Number(resultRow['__row_count'] ?? 0);
    // rawRowCount IS the sampled count; no scale-up needed (we care about rates, not absolutes)
    const rowCount = rawRowCount;

    const columnsProfile: Record<string, any> = {};

    for (const col of cols) {
      const colSafe = col.name;
      const modeEntry = columnModes.get(col.name);
      const mode = modeEntry?.mode ?? 'full';

      if (mode === 'skipped') {
        columnsProfile[colSafe] = {
          data_type: col.data_type,
          skipped: true,
          skip_reason: modeEntry?.skipReason ?? 'heavy_column_type',
        };
        continue;
      }

      const rawNullCount = Number(resultRow[`${colSafe}_null_cnt`] ?? 0);
      const nullCount = rawNullCount;
      const nullRate = rowCount > 0 ? nullCount / rowCount : 0.0;

      const profile: Record<string, any> = {
        data_type: col.data_type,
        null_count: nullCount,
        null_rate: nullRate,
      };

      if (mode === 'null_only' && modeEntry?.skipReason) {
        profile.stats_deferred = true;
        profile.defer_reason = modeEntry.skipReason;
      }

      if (mode === 'full' && !isComplexType(col.data_type)) {
        const distinctEst = Number(resultRow[`${colSafe}_distinct_cnt`] ?? 0);
        profile.distinct_est = distinctEst;

        if (distinctEst <= 50 && !isUnsupportedTopKType(col.data_type)) {
          const rawTopK = resultRow[`${colSafe}_top_k`] ?? null;
          profile.top_k = parseTopK(rawTopK);
        }

        if (!isBooleanType(col.data_type)) {
          profile.min = resultRow[`${colSafe}_min`] !== undefined && resultRow[`${colSafe}_min`] !== null ? resultRow[`${colSafe}_min`] : null;
          profile.max = resultRow[`${colSafe}_max`] !== undefined && resultRow[`${colSafe}_max`] !== null ? resultRow[`${colSafe}_max`] : null;
        }
      }

      columnsProfile[colSafe] = profile;
    }

    return {
      ref,
      capturedAt: new Date(),
      stats: {
        row_count: rowCount,
        size_bytes: sizeBytes,
        is_sampled: useSubquery,
        profile_window_rows: useSubquery ? rowLimit : null,
        sample_pct: useSubquery && effectiveRows > 0
          ? Math.min(100, ((rowLimit ?? 0) / effectiveRows) * 100)
          : 100,
        query_count: statementCount,
        ...(Object.keys(skippedNotes).length > 0 ? { skipped_columns: skippedNotes } : {}),
        columns: columnsProfile,
      },
    };
  }

  // ── fetchSampleRows ───────────────────────────────────────────────────────────

  async fetchSampleRows(fullPath: string, limit: number): Promise<Record<string, unknown>[]> {
    const parts = fullPath.split('.');
    if (parts.length < 3) {
      throw new Error(`Invalid full_path for sample fetch: "${fullPath}"`);
    }

    const [catalog, schema, ...tableParts] = parts;
    const table = tableParts.join('.');
    const catSafe = safeId(catalog, 'catalog');
    const schSafe = safeId(schema, 'schema');
    const tblSafe = safeId(table, 'table');
    const rowLimit = Math.max(1, Math.min(limit, 20));

    const result = await this.exec(
      `SELECT * FROM \`${catSafe}\`.\`${schSafe}\`.\`${tblSafe}\` LIMIT ${rowLimit}`,
    );

    return result.rows;
  }

  // ── inventoryEstate ─────────────────────────────────────────────────────────
  // Full metadata inventory via information_schema.tables.
  // Yields batches of ≤1000 EstateRow objects. Zero warehouse scans.

  async *inventoryEstate(source: ContextSource): AsyncGenerator<EstateRow[]> {
    const includes = source.scope_include ?? ['*.*.*'];
    const excludes = source.scope_exclude ?? [];

    // system.information_schema.tables only covers the 'system' catalog in Unity Catalog,
    // not all catalogs. Always use per-catalog mode so each catalog's own information_schema
    // is queried directly, giving a complete and accurate view.
    yield* this.inventoryPerCatalog(includes, excludes);
  }

  private async probeInventoryMode(): Promise<'system' | 'per-catalog'> {
    try {
      await this.exec('SELECT 1 FROM system.information_schema.tables LIMIT 1');
      return 'system';
    } catch {
      return 'per-catalog';
    }
  }

  private async *inventorySingleSweep(
    includes: string[],
    excludes: string[],
  ): AsyncGenerator<EstateRow[]> {
    const result = await this.exec(
      `SELECT table_catalog, table_schema, table_name, table_type, comment, last_altered ` +
      `FROM system.information_schema.tables`
    );

    let batch: EstateRow[] = [];
    for (const row of result.rows) {
      const cat = String(row['table_catalog'] ?? '');
      const sch = String(row['table_schema'] ?? '');
      const tbl = String(row['table_name'] ?? '');
      const fullPath = buildFullPath(cat, sch, tbl);

      if (sch === 'information_schema') continue;

      const included = matchesScope(fullPath, includes, excludes);
      if (!included) continue;

      const parsed = EstateRowSchema.parse({
        table_schema: sch.trim().toLowerCase(),
        table_name: tbl.trim().toLowerCase(),
        table_type: String(row['table_type'] ?? 'TABLE'),
        comment: row['comment'] ? String(row['comment']) : null,
        last_altered: row['last_altered'] ? String(row['last_altered']) : null,
      });

      batch.push(parsed);
      if (batch.length >= 1000) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
  }

  private async *inventoryPerCatalog(
    includes: string[],
    excludes: string[],
  ): AsyncGenerator<EstateRow[]> {
    const catalogResult = await this.scopeExec('SHOW CATALOGS');
    const allCatalogs = catalogResult.rows
      .map(r => String(r['catalog'] ?? r['databaseName'] ?? ''))
      .filter(Boolean);

    const candidateCatalogs = allCatalogs.filter(cat =>
      catalogMatchesIncludes(cat, includes)
    );

    let batch: EstateRow[] = [];

    for (const catalog of candidateCatalogs) {
      const catSafe = safeId(catalog, 'catalog');
      let result;
      try {
        result = await this.scopeExec(
          `SELECT table_catalog, table_schema, table_name, table_type, comment, last_altered ` +
          `FROM \`${catSafe}\`.information_schema.tables ` +
          `WHERE table_schema != 'information_schema'`,
          { rowLimit: 100_000 },
        );
      } catch (e) {
        console.warn(`inventoryEstate: skipping catalog ${catalog}:`, e instanceof Error ? e.message : String(e));
        continue;
      }

      for (const row of result.rows) {
        const cat = String(row['table_catalog'] ?? catalog);
        const sch = String(row['table_schema'] ?? '');
        const tbl = String(row['table_name'] ?? '');
        const fullPath = buildFullPath(cat, sch, tbl);

        const included = matchesScope(fullPath, includes, excludes);
        if (!included) continue;

        const parsed = EstateRowSchema.parse({
          table_catalog: cat.trim().toLowerCase(),
          table_schema: sch.trim().toLowerCase(),
          table_name: tbl.trim().toLowerCase(),
          table_type: String(row['table_type'] ?? 'TABLE'),
          comment: row['comment'] ? String(row['comment']) : null,
          last_altered: row['last_altered'] ? String(row['last_altered']) : null,
        });

        batch.push(parsed);
        if (batch.length >= 1000) {
          yield batch;
          batch = [];
        }
      }
    }
    if (batch.length > 0) yield batch;
  }

  // ── pullQueryHistoryWindow ───────────────────────────────────────────────────
  // Windowed scan of system.query.history using cursor-based pagination on
  // start_time. Databricks partitions system.query.history by start_time, so
  // filtering and ordering by start_time allows partition pruning and avoids the
  // full-scan query cancellations that update_time-based queries hit on older data.
  // Returns all SELECT statements between `since` and `until`, stopping at
  // `rowCap` rows. If capped, `nextCursor` holds the oldest `start_time` seen
  // so the caller can spawn a continuation job.

  async pullQueryHistoryWindow(
    _source: ContextSource,
    since: Date,
    until: Date,
    rowCap: number,
  ): Promise<{ rows: RawHistoryRow[]; nextCursor: Date | null }> {
    const sinceIso = since.toISOString().replace('T', ' ').replace('Z', '');
    const untilIso = until.toISOString().replace('T', ' ').replace('Z', '');

    // Smaller pages keep each query well under the 50s warehouse timeout even on
    // older/cold partitions. Async polling in scopeExec removes the 50s hard cut,
    // but smaller pages also reduce per-page latency and memory overhead.
    const PAGE_SIZE = 100;
    const allRows: RawHistoryRow[] = [];
    let cursorTime: string | null = null;

    // Per-page retry config — transient CANCELED responses (e.g. warehouse cold
    // start, momentary load spike) are retried with exponential backoff.
    // If all retries are exhausted on a CANCELED page we break out of the
    // pagination loop and return the rows already fetched with nextCursor set
    // to the current cursor position so a continuation job can cover the
    // older slice. This prevents one bad partition from discarding all rows
    // accumulated so far.
    const MAX_PAGE_RETRIES = 3;
    const RETRY_BASE_MS = 5_000;

    while (true) {
      const cursorClause = cursorTime
        ? `AND start_time < TIMESTAMP '${cursorTime}' `
        : '';

      const sql =
        `SELECT LEFT(statement_text, 8000) AS statement_text, executed_as, start_time, update_time, query_source, produced_rows ` +
        `FROM system.query.history ` +
        `WHERE start_time >= TIMESTAMP '${sinceIso}' ` +
        `  AND start_time < TIMESTAMP '${untilIso}' ` +
        `  AND statement_type = 'SELECT' ` +
        cursorClause +
        `ORDER BY start_time DESC ` +
        `LIMIT ${PAGE_SIZE}`;

      let result: Awaited<ReturnType<typeof this.scopeExec>>;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoffMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.log(`[pullQueryHistoryWindow] retry attempt=${attempt} after ${backoffMs}ms cursor=${cursorTime ?? 'start'}`);
          await new Promise(r => setTimeout(r, backoffMs));
        }
        try {
          result = await this.scopeExec(sql, { rowLimit: PAGE_SIZE });
          lastErr = undefined;
          break;
        } catch (err: unknown) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // Only retry on CANCELED — FAILED means a real query error
          if (!msg.includes('CANCELED')) throw err;
          console.warn(`[pullQueryHistoryWindow] page CANCELED attempt=${attempt} cursor=${cursorTime ?? 'start'}: ${msg}`);
        }
      }
      if (lastErr !== undefined) {
        // All retries exhausted on a persistent CANCELED page.
        // Surface the rows collected so far and return a nextCursor so the
        // caller can spawn a continuation job for the older window slice
        // rather than discarding all already-fetched rows.
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        console.warn(
          `[pullQueryHistoryWindow] page CANCELED after ${MAX_PAGE_RETRIES} retries — ` +
          `returning ${allRows.length} rows already fetched with nextCursor=${cursorTime ?? 'start'}: ${msg}`,
        );
        const nextCursor = cursorTime ? new Date(cursorTime) : null;
        return { rows: allRows, nextCursor };
      }

      const pageRows = result!.rows
        .filter(r => r['statement_text'] != null)
        .map(r => ({
          statement_text: String(r['statement_text']),
          executed_as: r['executed_as'] != null ? String(r['executed_as']) : null,
          start_time: r['start_time'] != null ? String(r['start_time']) : null,
          update_time: r['update_time'] != null ? String(r['update_time']) : null,
          query_source: r['query_source'] ?? null,
          produced_rows: r['produced_rows'] != null ? Number(r['produced_rows']) : null,
        }));

      allRows.push(...pageRows);

      console.log(`[pullQueryHistoryWindow] page cursor=${cursorTime ?? 'start'} got=${pageRows.length} total_so_far=${allRows.length}`);

      // Last page — no more data
      if (result!.rows.length < PAGE_SIZE) break;

      // Hard cap — stop and signal continuation needed
      if (allRows.length >= rowCap) {
        const lastStartTime = pageRows[pageRows.length - 1]?.start_time;
        const nextCursor = lastStartTime ? new Date(lastStartTime) : null;
        console.log(`[pullQueryHistoryWindow] rowCap=${rowCap} reached — nextCursor=${nextCursor?.toISOString()}`);
        return { rows: allRows, nextCursor };
      }

      // Advance cursor using start_time
      const lastStartTime = pageRows[pageRows.length - 1]?.start_time;
      if (!lastStartTime) break;
      cursorTime = lastStartTime;
    }

    return { rows: allRows, nextCursor: null };
  }

  // ── pullTableLineage ─────────────────────────────────────────────────────────
  // One windowed scan of system.access.table_lineage. Rows where either
  // endpoint is null are post-filtered out.

  async pullTableLineage(
    _source: ContextSource,
    windowDays: number,
    rowCap: number,
  ): Promise<RawTableLineageRow[]> {
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      throw new Error(`pullTableLineage: windowDays must be a positive integer, got ${windowDays}`);
    }
    if (!Number.isInteger(rowCap) || rowCap <= 0) {
      throw new Error(`pullTableLineage: rowCap must be a positive integer, got ${rowCap}`);
    }

    const result = await this.scopeExec(
      `SELECT source_table_full_name, target_table_full_name ` +
      `FROM system.access.table_lineage ` +
      `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${windowDays} DAYS ` +
      `LIMIT ${rowCap}`,
      { rowLimit: rowCap },
    );

    return result.rows
      .filter(r => typeof r['source_table_full_name'] === 'string' && typeof r['target_table_full_name'] === 'string')
      .map(r => ({
        source_table_full_name: String(r['source_table_full_name']),
        target_table_full_name: String(r['target_table_full_name']),
      }));
  }

  // ── pullColumnLineage ────────────────────────────────────────────────────────
  // One windowed scan of system.access.column_lineage. Rows where any of the
  // four fields is null are post-filtered out.

  async pullColumnLineage(
    _source: ContextSource,
    windowDays: number,
    rowCap: number,
  ): Promise<RawColumnLineageRow[]> {
    if (!Number.isInteger(windowDays) || windowDays <= 0) {
      throw new Error(`pullColumnLineage: windowDays must be a positive integer, got ${windowDays}`);
    }
    if (!Number.isInteger(rowCap) || rowCap <= 0) {
      throw new Error(`pullColumnLineage: rowCap must be a positive integer, got ${rowCap}`);
    }

    const result = await this.scopeExec(
      `SELECT source_table_full_name, source_column_name, target_table_full_name, target_column_name ` +
      `FROM system.access.column_lineage ` +
      `WHERE event_time >= CURRENT_TIMESTAMP() - INTERVAL ${windowDays} DAYS ` +
      `LIMIT ${rowCap}`,
      { rowLimit: rowCap },
    );

    return result.rows
      .filter(r =>
        typeof r['source_table_full_name'] === 'string' &&
        typeof r['source_column_name'] === 'string' &&
        typeof r['target_table_full_name'] === 'string' &&
        typeof r['target_column_name'] === 'string'
      )
      .map(r => ({
        source_table_full_name: String(r['source_table_full_name']),
        source_column_name: String(r['source_column_name']),
        target_table_full_name: String(r['target_table_full_name']),
        target_column_name: String(r['target_column_name']),
      }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Scope/inventory queries can scan large information_schema views — use API max wait (50s). */
  private async scopeExec(sql: string, opts?: { rowLimit?: number }) {
    return this.exec(sql, { ...opts, waitTimeoutSecs: DATABRICKS_API_MAX_WAIT_SECS, asyncPolling: true });
  }

  private async exec(sql: string, opts?: { rowLimit?: number; waitTimeoutSecs?: number; asyncPolling?: boolean }) {
    this._queryCount++;
    const token = await getAccessToken(this.conn.id, this.conn.workspace_host);
    return executeDatabricksSQL(
      this.conn.id,
      this.conn.workspace_host,
      this.conn.default_warehouse_id,
      token,
      {
        statement: sql,
        ...(opts?.rowLimit !== undefined ? { rowLimit: opts.rowLimit } : {}),
        ...(opts?.waitTimeoutSecs !== undefined ? { waitTimeoutSecs: opts.waitTimeoutSecs } : {}),
        ...(opts?.asyncPolling ? { asyncPolling: true } : {}),
      },
    );
  }
}

const PROFILE_SIZE_FULL_TABLE_MAX = 10_000_000; // 10 MB — scan whole table
const PROFILE_SIZE_LARGE_TABLE = 1_000_000_000; // 1 GB — drop to 5k row window
const PROFILE_ROW_LIMIT_DEFAULT = 10_000;
const PROFILE_ROW_LIMIT_LARGE = 5_000;
const PROFILE_ROW_LIMIT_HUGE = 2_000; // wide rows (>1 MB avg) — smallest window
const PROFILE_AVG_ROW_BYTES_HUGE = 1_000_000;
const PROFILE_MAX_FULL_STAT_COLUMNS = 60;

type ColumnProfileMode = 'full' | 'null_only' | 'skipped';

function resolveProfileWindow(
  sizeBytes: number | null,
  budgetEstimatedRows: number | undefined,
): {
  rowLimit: number;
  useSubquery: boolean;
  effectiveRows: number;
  avgRowBytes: number | null;
} {
  let estimatedRows = budgetEstimatedRows;
  if (estimatedRows === undefined && sizeBytes !== null) {
    estimatedRows = sizeBytes / 100;
  }
  const sizeBasedRows = sizeBytes !== null ? sizeBytes / 100 : undefined;
  const effectiveRows = Math.max(estimatedRows ?? 0, sizeBasedRows ?? 0);
  const avgRowBytes =
    sizeBytes !== null && effectiveRows > 0 ? sizeBytes / effectiveRows : null;

  const useSubquery =
    effectiveRows === 0 ||
    effectiveRows >= PROFILE_ROW_LIMIT_DEFAULT ||
    (sizeBytes !== null && sizeBytes > PROFILE_SIZE_FULL_TABLE_MAX);

  if (!useSubquery) {
    return { rowLimit: PROFILE_ROW_LIMIT_DEFAULT, useSubquery: false, effectiveRows, avgRowBytes };
  }

  let rowLimit = PROFILE_ROW_LIMIT_DEFAULT;
  if (sizeBytes !== null && sizeBytes > PROFILE_SIZE_LARGE_TABLE) {
    rowLimit = PROFILE_ROW_LIMIT_LARGE;
  }
  if (avgRowBytes !== null && avgRowBytes > PROFILE_AVG_ROW_BYTES_HUGE) {
    rowLimit = Math.min(rowLimit, PROFILE_ROW_LIMIT_HUGE);
  }

  return { rowLimit, useSubquery: true, effectiveRows, avgRowBytes };
}

function classifyProfileColumns(
  cols: { name: string; data_type: string; is_nullable: boolean }[],
  avgRowBytes: number | null,
): Map<string, { mode: ColumnProfileMode; skipReason?: string }> {
  const modes = new Map<string, { mode: ColumnProfileMode; skipReason?: string }>();
  let fullCount = 0;

  for (const col of cols) {
    if (isGhostColumnType(col.data_type)) {
      modes.set(col.name, { mode: 'skipped', skipReason: 'void_column' });
      continue;
    }
    if (isHeavyColumnType(col.data_type)) {
      modes.set(col.name, { mode: 'skipped', skipReason: 'heavy_column_type' });
      continue;
    }
    if (avgRowBytes !== null && avgRowBytes > 100_000 && isWideStringType(col.data_type)) {
      modes.set(col.name, { mode: 'null_only', skipReason: 'wide_row_string' });
      continue;
    }
    if (fullCount >= PROFILE_MAX_FULL_STAT_COLUMNS) {
      modes.set(col.name, { mode: 'null_only', skipReason: 'wide_table_column_cap' });
      continue;
    }
    modes.set(col.name, { mode: 'full' });
    fullCount++;
  }

  return modes;
}

/** Columns in information_schema with NULL/void type — not present in physical storage. */
function isGhostColumnType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'null' || t === 'void';
}

function isHeavyColumnType(type: string): boolean {
  if (isComplexType(type)) return true;
  const t = type.toLowerCase();
  return t.includes('binary') || t.includes('blob') || t === 'variant'
    || t.includes('geography') || t.includes('geometry');
}

function isWideStringType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'string' || t.startsWith('varchar') || t.startsWith('char') || t === 'text';
}

function isComplexType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes('array') || t.includes('map') || t.includes('struct');
}

function isBooleanType(type: string): boolean {
  return type.toLowerCase() === 'boolean';
}

/** Types Databricks rejects for APPROX_TOP_K (timestamp, void/null, binary, etc.). */
function isUnsupportedTopKType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes('timestamp') || t.includes('date') || t === 'time' || t.startsWith('time ')
    || t.includes('binary') || t.includes('blob') || t.includes('interval')
    || t === 'void' || t.includes('void')
    || t === 'null'; // information_schema reports void columns as NULL
}

function parseTopK(val: unknown): { value: unknown; count: number }[] {
  if (!val) return [];
  try {
    const arr = typeof val === 'string' ? JSON.parse(val) : val;
    if (Array.isArray(arr)) {
      return arr.map((x: any) => ({
        value: x.item ?? null,
        count: Number(x.count ?? 0),
      }));
    }
  } catch {
    // ignore
  }
  return [];
}
