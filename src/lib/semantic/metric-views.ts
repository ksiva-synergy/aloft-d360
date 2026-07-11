/**
 * src/lib/semantic/metric-views.ts
 *
 * Compiles governed measures to Databricks Unity Catalog view DDL and
 * optionally applies them via the Databricks Statement Execution API.
 *
 * Namespace: views land in <catalog>.spinor_semantic.mv_<entity>_<measure>
 * so Spinor-generated objects are clearly separated from client-managed ones
 * and easy to tear down independently.
 *
 * DDL note: uses CREATE OR REPLACE VIEW (standard SQL).
 * Upgrade path: when UC Business Semantics DDL (CREATE METRIC VIEW) is
 * confirmed stable, replace the VIEW syntax here — the rest of the pipeline
 * is unaffected.
 */

import prisma from '@/lib/db';
import { compileSafety } from './compiler';
import { executeDatabricksDDL } from '@/lib/databricks/execute';
import { getAccessToken } from '@/lib/databricks/token-client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricViewEntity {
  full_path: string;    // canonical: catalog.schema.table
  entity_label: string;
}

export interface MetricViewDimension {
  column_name: string;
  dimension_label: string;
}

export interface MetricViewMeasure {
  id: string;
  column_name: string | null;
  measure_label: string;
  aggregate: string;
  expression: string | null;
  metric_type: string;  // simple | cumulative | ratio | derived
}

export interface ApplyResult {
  applied: number;
  failed: number;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a label to a safe SQL identifier fragment (snake_case, no spaces).
 */
function toAlias(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Map aggregate name to SQL function.
 */
function aggToSql(aggregate: string): string {
  switch (aggregate) {
    case 'sum':            return 'SUM';
    case 'mean':           return 'AVG';
    case 'count':          return 'COUNT';
    case 'count_distinct': return 'COUNT(DISTINCT ';
    case 'min':            return 'MIN';
    case 'max':            return 'MAX';
    default:               return aggregate.toUpperCase();
  }
}

/**
 * Build the aggregate expression for a column.
 */
function buildAggExpr(aggregate: string, columnName: string): string {
  if (aggregate === 'count_distinct') return `COUNT(DISTINCT ${columnName})`;
  if (aggregate === 'median') return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${columnName})`;
  return `${aggToSql(aggregate)}(${columnName})`;
}

// ── DDL compiler ──────────────────────────────────────────────────────────────

/**
 * Compile governed measures to CREATE OR REPLACE VIEW DDL strings.
 *
 * Target schema: <catalog>.spinor_semantic (Spinor-controlled namespace).
 * View name pattern: mv_<entity_alias>_<measure_alias>
 *
 * Each emitted array starts with a CREATE SCHEMA IF NOT EXISTS statement
 * to ensure the target schema exists before the views.
 *
 * Metric type mapping:
 *   simple     → AGG(column_name) AS alias — direct
 *   cumulative → same as simple (window is additive; materialized view is the right
 *                upgrade path — best-effort for now)
 *   ratio      → inline expression (compileSafety checked)
 *   derived    → inline expression (compileSafety checked)
 *
 * Returns empty array for entities with no compilable measures.
 * Never throws — logs and skips uncompilable measures.
 */
export function compileMetricViewDDL(
  entity: MetricViewEntity,
  measures: MetricViewMeasure[],
  dimensions: MetricViewDimension[],
): string[] {
  const parts = entity.full_path.split('.');
  if (parts.length !== 3) {
    console.warn(`[metric-views] skipping entity '${entity.full_path}' — expected catalog.schema.table`);
    return [];
  }
  const [catalog] = parts;
  const entityAlias = toAlias(entity.entity_label);
  const targetSchema = `${catalog}.spinor_semantic`;

  const dimSelectParts = dimensions.map((d) => d.column_name);
  const dimGroupBy = dimSelectParts.join(', ');

  const statements: string[] = [];

  // Ensure the target schema exists (prepend once per entity block)
  statements.push(
    `-- Spinor-managed schema for generated metric views\nCREATE SCHEMA IF NOT EXISTS ${targetSchema};`,
  );

  for (const measure of measures) {
    const measureAlias = toAlias(measure.measure_label);
    const viewName = `${targetSchema}.mv_${entityAlias}_${measureAlias}`;

    let aggExpr: string;

    if (measure.metric_type === 'ratio' || measure.metric_type === 'derived') {
      if (!measure.expression) {
        console.warn(`[metric-views] skipping measure '${measure.id}' (${measure.metric_type}): no expression`);
        continue;
      }
      const safety = compileSafety(measure.expression);
      if (!safety.safe) {
        console.warn(
          `[metric-views] skipping measure '${measure.id}': expression rejected — ${safety.reason}`,
        );
        continue;
      }
      aggExpr = measure.expression;
    } else if (measure.metric_type === 'simple' || measure.metric_type === 'cumulative') {
      if (!measure.column_name) {
        console.warn(
          `[metric-views] skipping measure '${measure.id}' (${measure.metric_type}): no column_name`,
        );
        continue;
      }
      aggExpr = buildAggExpr(measure.aggregate, measure.column_name);
    } else {
      console.warn(`[metric-views] skipping measure '${measure.id}': unknown metric_type '${measure.metric_type}'`);
      continue;
    }

    const selectCols = dimSelectParts.length > 0
      ? `${dimSelectParts.join(',\n       ')},\n       ${aggExpr} AS ${measureAlias}`
      : `${aggExpr} AS ${measureAlias}`;

    const groupByClause = dimGroupBy ? `GROUP BY ${dimGroupBy}` : '';

    // Cumulative note in comment
    const metricNote = measure.metric_type === 'cumulative'
      ? '\n-- NOTE: cumulative metric compiled as a simple aggregate view (best-effort).\n-- Upgrade to a window-function view or CREATE METRIC VIEW when business semantics DDL is stable.'
      : '';

    const ddl = [
      `-- Compiled as a regular view; upgrade to CREATE METRIC VIEW when UC Business Semantics DDL is confirmed stable (currently Preview).${metricNote}`,
      `CREATE OR REPLACE VIEW ${viewName}`,
      `AS`,
      `SELECT ${selectCols}`,
      `FROM ${entity.full_path}`,
      ...(groupByClause ? [groupByClause] : []),
    ].join('\n');

    statements.push(ddl);
  }

  // If only the schema statement was added (no compilable measures), return empty
  if (statements.length === 1) return [];

  return statements;
}

// ── Apply function ────────────────────────────────────────────────────────────

/**
 * Execute each DDL statement against the Databricks SQL warehouse via
 * executeDatabricksDDL (bypasses the read-only guard — DDL is intentional here).
 *
 * Collects successes and failures per statement. Never throws.
 */
export async function applyMetricViews(
  ddlStatements: string[],
  connectionId: string,
): Promise<ApplyResult> {
  const connection = await prisma.platformDatabricksConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });

  const token = await getAccessToken(connectionId, connection.workspace_host);

  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const statement of ddlStatements) {
    try {
      await executeDatabricksDDL(
        connectionId,
        connection.workspace_host,
        connection.default_warehouse_id,
        token,
        statement,
      );
      applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[metric-views] DDL failed: ${msg}\nStatement: ${statement.slice(0, 200)}`);
      failed++;
      errors.push(msg);
    }
  }

  return { applied, failed, errors };
}
