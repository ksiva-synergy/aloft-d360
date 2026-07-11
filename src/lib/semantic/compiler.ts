/**
 * src/lib/semantic/compiler.ts
 *
 * Compiles a SemanticQuery + loaded SemanticModel into a Databricks SQL string.
 * Does NOT execute the SQL — execution is handled by execute.ts.
 *
 * Compilation rules (hard):
 *  - Dimension filters → WHERE (pre-aggregation)
 *  - Measure filters   → HAVING (post-aggregation), using SELECT alias
 *  - Cumulative metrics → two-layer CTE (nested aggregates in window fns are invalid SQL)
 *  - compileSafety() runs on EVERY expression before inline — throws on DDL keywords
 */

import type {
  SemanticQuery,
  SemanticModel,
  SemanticModelDimension,
  SemanticModelMeasure,
  SemanticModelEntity,
  SemanticFilter,
  SemanticSort,
} from './types';

// ── Safety check ──────────────────────────────────────────────────────────────

const DDL_KEYWORDS = [
  'CREATE', 'DROP', 'ALTER', 'DELETE', 'INSERT', 'UPDATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL',
];

/**
 * Rejects any expression containing DDL keywords (case-insensitive token match).
 * Token boundary match — won't false-positive on substrings like "executions".
 */
export function compileSafety(expression: string): { safe: boolean; reason?: string } {
  const upper = expression.toUpperCase();
  for (const kw of DDL_KEYWORDS) {
    // Word-boundary check: keyword must be preceded/followed by non-word char or string boundary
    const re = new RegExp(`(?<![A-Z0-9_])${kw}(?![A-Z0-9_])`);
    if (re.test(upper)) {
      return { safe: false, reason: `Expression contains forbidden keyword: ${kw}` };
    }
  }
  return { safe: true };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Produce a safe SQL alias from a label (snake_case, no spaces or special chars).
 */
function toAlias(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Resolve the effective time grain for a dimension reference.
 * Per-dim grain overrides global; global applies to temporal dims without their own.
 */
function resolveGrain(
  dimRef: { dimensionId?: string; timeGrain?: string },
  globalGrain: string | undefined,
  dim: SemanticModelDimension,
): string | undefined {
  if (dim.dimension_type !== 'temporal') return undefined;
  return dimRef.timeGrain ?? globalGrain;
}

/**
 * Render a dimension column expression (with optional DATE_TRUNC).
 */
function renderDimExpr(columnName: string, grain: string | undefined): string {
  if (grain) {
    return `DATE_TRUNC('${grain}', ${columnName})`;
  }
  return columnName;
}

/**
 * Render a measure aggregate expression. Returns { expr, alias }.
 * Validates expression safety for derived/ratio metric types.
 */
function renderMeasureExpr(
  measure: SemanticModelMeasure,
): { expr: string; alias: string } {
  const alias = toAlias(measure.measure_label);

  if (measure.metric_type === 'ratio' || measure.metric_type === 'derived') {
    if (!measure.expression) {
      throw new Error(
        `Measure '${measure.id}' (${measure.metric_type}) has no expression field`,
      );
    }
    const safety = compileSafety(measure.expression);
    if (!safety.safe) {
      throw new Error(
        `Measure '${measure.id}' expression rejected: ${safety.reason}`,
      );
    }
    return { expr: measure.expression, alias };
  }

  if (measure.metric_type === 'cumulative' || measure.metric_type === 'simple') {
    if (!measure.column_name) {
      throw new Error(
        `Measure '${measure.id}' (${measure.metric_type}) requires column_name`,
      );
    }
    const aggFn = aggToSql(measure.aggregate);
    return { expr: `${aggFn}(${measure.column_name})`, alias };
  }

  throw new Error(`Unknown metric_type '${measure.metric_type}' on measure '${measure.id}'`);
}

function aggToSql(aggregate: string): string {
  switch (aggregate) {
    case 'sum':           return 'SUM';
    case 'mean':          return 'AVG';
    case 'count':         return 'COUNT';
    case 'count_distinct': return 'COUNT(DISTINCT ';  // handled specially below
    case 'min':           return 'MIN';
    case 'max':           return 'MAX';
    case 'median':        return 'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ';  // handled specially
    default:              return aggregate.toUpperCase();
  }
}

/**
 * Full aggregate expression (handles multi-word aggregates).
 */
function fullAggExpr(measure: SemanticModelMeasure): string {
  if (!measure.column_name) throw new Error(`column_name required for aggregate on '${measure.id}'`);
  const col = measure.column_name;
  switch (measure.aggregate) {
    case 'count_distinct': return `COUNT(DISTINCT ${col})`;
    case 'median':         return `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col})`;
    default:               return `${aggToSql(measure.aggregate)}(${col})`;
  }
}

/**
 * Compile a SemanticFilter to SQL fragment.
 * dimMap / measureMap used to resolve the actual column / alias name.
 */
function renderFilter(
  filter: SemanticFilter,
  dimMap: Map<string, SemanticModelDimension>,
  measureAliasMap: Map<string, string>,
  globalGrain: string | undefined,
  dimRefMap: Map<string, { timeGrain?: string }>,
): string {
  const { fieldId, fieldKind, op, value } = filter;

  if (fieldKind === 'dimension') {
    const dim = dimMap.get(fieldId);
    if (!dim) throw new Error(`Filter references unknown dimension '${fieldId}'`);
    const grain = resolveGrain(dimRefMap.get(fieldId) ?? {}, globalGrain, dim);
    const colExpr = renderDimExpr(dim.column_name, grain);
    return renderOpExpr(colExpr, op, value);
  } else {
    // measure filter → HAVING uses SELECT alias
    const alias = measureAliasMap.get(fieldId);
    if (!alias) throw new Error(`Filter references unknown measure '${fieldId}'`);
    return renderOpExpr(alias, op, value);
  }
}

function renderOpExpr(lhs: string, op: string, value: unknown): string {
  const lit = (v: unknown) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
    return String(v);
  };
  switch (op) {
    case 'eq':         return `${lhs} = ${lit(value)}`;
    case 'neq':        return `${lhs} <> ${lit(value)}`;
    case 'gt':         return `${lhs} > ${lit(value)}`;
    case 'gte':        return `${lhs} >= ${lit(value)}`;
    case 'lt':         return `${lhs} < ${lit(value)}`;
    case 'lte':        return `${lhs} <= ${lit(value)}`;
    case 'is_null':    return `${lhs} IS NULL`;
    case 'is_not_null': return `${lhs} IS NOT NULL`;
    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      return `${lhs} IN (${arr.map(lit).join(', ')})`;
    }
    case 'not_in': {
      const arr = Array.isArray(value) ? value : [value];
      return `${lhs} NOT IN (${arr.map(lit).join(', ')})`;
    }
    case 'between': {
      const arr = Array.isArray(value) ? value : [value, value];
      return `${lhs} BETWEEN ${lit(arr[0])} AND ${lit(arr[1])}`;
    }
    default: throw new Error(`Unknown filter op '${op}'`);
  }
}

// ── Main compiler ─────────────────────────────────────────────────────────────

/**
 * Compile a SemanticQuery to a Databricks SQL string.
 *
 * Supported patterns:
 *  (a) Single entity — SELECT dims, AGG(measures) FROM full_path GROUP BY dims
 *  (b) Two-entity join — adds {join_type} JOIN entity_b ON join_on_sql
 *  (c) Simple metric — AGG(column_name)
 *  (d) Ratio metric — inline expression (safety-checked)
 *  (e) Cumulative metric — two-layer CTE (inner GROUP BY, outer OVER window)
 *  (f) Derived metric — inline expression (safety-checked)
 *
 * Throws on: unknown IDs, unsafe expressions, missing required fields, missing join.
 */
export function compileSemanticQuery(
  query: SemanticQuery,
  model: SemanticModel,
): string {
  const limit = Math.min(query.limit ?? 1000, 10_000);

  // ── Index model into maps ─────────────────────────────────────────────────
  const entityMap = new Map<string, SemanticModelEntity>(
    model.entities.map((e) => [e.id, e]),
  );
  const dimMap = new Map<string, SemanticModelDimension>(
    model.dimensions.map((d) => [d.id, d]),
  );
  const measureMap = new Map<string, SemanticModelMeasure>(
    model.measures.map((m) => [m.id, m]),
  );

  // ── Resolve primary entity ────────────────────────────────────────────────
  const primaryEntity = entityMap.get(query.entityId);
  if (!primaryEntity) {
    throw new Error(`Entity '${query.entityId}' not found in model`);
  }

  // ── Resolve requested dimensions and measures ─────────────────────────────
  const requestedDims = query.dimensions.map((ref) => {
    const dim = dimMap.get(ref.dimensionId);
    if (!dim) throw new Error(`Dimension '${ref.dimensionId}' not found in model`);
    return { ref, dim };
  });

  const requestedMeasures = query.measures.map((ref) => {
    const measure = measureMap.get(ref.measureId);
    if (!measure) throw new Error(`Measure '${ref.measureId}' not found in model`);
    return { ref, measure };
  });

  // ── Detect secondary entities (for join) ─────────────────────────────────
  const involvedEntityIds = new Set<string>([query.entityId]);
  for (const { dim } of requestedDims) involvedEntityIds.add(dim.entity_id);
  for (const { measure } of requestedMeasures) involvedEntityIds.add(measure.entity_id);

  const secondaryEntityIds = [...involvedEntityIds].filter((id) => id !== query.entityId);

  if (secondaryEntityIds.length > 1) {
    throw new Error(
      `S1 compiler supports at most one secondary entity (two-entity joins). ` +
      `Got ${secondaryEntityIds.length}: ${secondaryEntityIds.join(', ')}`,
    );
  }

  // ── Build FROM clause ─────────────────────────────────────────────────────
  // full_path is already lowercased canonical form (buildFullPath convention)
  const primaryAlias = 'a';
  let fromClause = `${primaryEntity.full_path} ${primaryAlias}`;

  if (secondaryEntityIds.length === 1) {
    const secId = secondaryEntityIds[0];
    const secEntity = entityMap.get(secId);
    if (!secEntity) throw new Error(`Secondary entity '${secId}' not found in model`);

    const join = model.joins.find(
      (j) =>
        (j.from_entity_id === query.entityId && j.to_entity_id === secId) ||
        (j.from_entity_id === secId && j.to_entity_id === query.entityId),
    );
    if (!join) {
      throw new Error(
        `No join defined between entity '${query.entityId}' and '${secId}'. ` +
        `Add a platform_sem_joins row for this pair.`,
      );
    }

    const secondaryAlias = 'b';
    const jt = join.join_type.toUpperCase();
    fromClause = `${primaryEntity.full_path} ${primaryAlias}\n  ${jt} JOIN ${secEntity.full_path} ${secondaryAlias} ON ${join.join_on_sql}`;
  }

  // ── Build a map of dimId → DimRef (for grain resolution) ─────────────────
  const dimRefMap = new Map<string, { timeGrain?: string }>(
    query.dimensions.map((r) => [r.dimensionId, r]),
  );

  // ── Build SELECT fragments ────────────────────────────────────────────────
  const dimSelectParts: string[] = requestedDims.map(({ ref, dim }) => {
    const grain = resolveGrain(ref, query.timeGrain, dim);
    const expr = renderDimExpr(dim.column_name, grain);
    const alias = toAlias(dim.dimension_label);
    return `${expr} AS ${alias}`;
  });

  // Measure aliases — needed for HAVING references
  const measureAliasMap = new Map<string, string>();
  for (const { measure } of requestedMeasures) {
    measureAliasMap.set(measure.id, toAlias(measure.measure_label));
  }

  const hasCumulative = requestedMeasures.some(
    ({ measure }) => measure.metric_type === 'cumulative',
  );

  // ── Check for filters / having splits ────────────────────────────────────
  const whereParts: string[] = [];
  const havingParts: string[] = [];

  for (const filter of query.filters) {
    const fragment = renderFilter(filter, dimMap, measureAliasMap, query.timeGrain, dimRefMap);
    if (filter.fieldKind === 'dimension') {
      whereParts.push(fragment);
    } else {
      havingParts.push(fragment);
    }
  }

  // ── Build GROUP BY ────────────────────────────────────────────────────────
  const groupByParts: string[] = requestedDims.map(({ ref, dim }) => {
    const grain = resolveGrain(ref, query.timeGrain, dim);
    return renderDimExpr(dim.column_name, grain);
  });

  // ── ORDER BY ──────────────────────────────────────────────────────────────
  const orderByParts: string[] = query.sorts.map((s) => {
    if (s.fieldKind === 'dimension') {
      const dim = dimMap.get(s.fieldId);
      if (!dim) throw new Error(`Sort references unknown dimension '${s.fieldId}'`);
      const ref = dimRefMap.get(s.fieldId) ?? {};
      const grain = resolveGrain(ref, query.timeGrain, dim);
      return `${renderDimExpr(dim.column_name, grain)} ${s.direction.toUpperCase()}`;
    } else {
      const alias = measureAliasMap.get(s.fieldId);
      if (!alias) throw new Error(`Sort references unknown measure '${s.fieldId}'`);
      return `${alias} ${s.direction.toUpperCase()}`;
    }
  });

  const whereClause  = whereParts.length  ? `WHERE ${whereParts.join(' AND ')}`   : '';
  const havingClause = havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : '';
  const orderClause  = orderByParts.length ? `ORDER BY ${orderByParts.join(', ')}` : '';
  const limitClause  = `LIMIT ${limit}`;

  // ── NON-CUMULATIVE path (single SELECT) ───────────────────────────────────
  if (!hasCumulative) {
    const measureSelectParts = requestedMeasures.map(({ measure }) => {
      if (measure.metric_type === 'ratio' || measure.metric_type === 'derived') {
        const safety = compileSafety(measure.expression ?? '');
        if (!safety.safe) {
          throw new Error(`Measure '${measure.id}' expression rejected: ${safety.reason}`);
        }
        return `${measure.expression} AS ${toAlias(measure.measure_label)}`;
      }
      return `${fullAggExpr(measure)} AS ${toAlias(measure.measure_label)}`;
    });

    const selectParts = [...dimSelectParts, ...measureSelectParts];

    const lines: string[] = [
      `SELECT ${selectParts.join(',\n       ')}`,
      `FROM ${fromClause}`,
    ];
    if (whereClause)  lines.push(whereClause);
    if (groupByParts.length) lines.push(`GROUP BY ${groupByParts.join(', ')}`);
    if (havingClause) lines.push(havingClause);
    if (orderClause)  lines.push(orderClause);
    lines.push(limitClause);

    return lines.join('\n');
  }

  // ── CUMULATIVE path — two-layer CTE ───────────────────────────────────────
  //
  // WITH _agg AS (
  //   SELECT <dims>, AGG(<col>) AS <alias>, ...   -- all measures aggregated
  //   FROM <full_path>
  //   [WHERE <dimension_filters>]
  //   GROUP BY <dims>
  // )
  // SELECT <dims>,
  //   SUM(<alias>) OVER (ORDER BY <time_dim> ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS <alias>,  -- cumulative
  //   <alias>,   -- non-cumulative: pass through unchanged
  //   ...
  // FROM _agg
  // [HAVING <measure_filters>]
  // [ORDER BY ...]
  // LIMIT <n>

  // Find the time dim for the OVER clause (first temporal dim in request)
  const timeDimEntry = requestedDims.find(
    ({ dim }) => dim.dimension_type === 'temporal',
  );
  const timeDimAlias = timeDimEntry
    ? toAlias(timeDimEntry.dim.dimension_label)
    : null;

  // Inner CTE SELECT: dims + all measure aggregates
  const innerMeasureParts = requestedMeasures.map(({ measure }) => {
    if (measure.metric_type === 'ratio' || measure.metric_type === 'derived') {
      const safety = compileSafety(measure.expression ?? '');
      if (!safety.safe) {
        throw new Error(`Measure '${measure.id}' expression rejected: ${safety.reason}`);
      }
      return `${measure.expression} AS ${toAlias(measure.measure_label)}`;
    }
    return `${fullAggExpr(measure)} AS ${toAlias(measure.measure_label)}`;
  });

  const innerSelectParts = [...dimSelectParts, ...innerMeasureParts];

  const innerLines: string[] = [
    `  SELECT ${innerSelectParts.join(',\n         ')}`,
    `  FROM ${fromClause}`,
  ];
  if (whereClause) innerLines.push(`  ${whereClause}`);
  if (groupByParts.length) innerLines.push(`  GROUP BY ${groupByParts.join(', ')}`);

  // Outer SELECT: dims pass-through, cumulative measures get OVER, others pass-through by alias
  const dimAliasParts = requestedDims.map(({ dim }) => toAlias(dim.dimension_label));

  const outerMeasureParts = requestedMeasures.map(({ measure }) => {
    const alias = toAlias(measure.measure_label);
    if (measure.metric_type === 'cumulative') {
      const orderBy = timeDimAlias
        ? `ORDER BY ${timeDimAlias} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`
        : 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW';
      return `SUM(${alias}) OVER (${orderBy}) AS ${alias}`;
    }
    return alias;
  });

  const outerSelectParts = [...dimAliasParts, ...outerMeasureParts];

  const outerLines: string[] = [
    `SELECT ${outerSelectParts.join(',\n       ')}`,
    `FROM _agg`,
  ];
  if (havingClause) outerLines.push(havingClause);
  if (orderClause)  outerLines.push(orderClause);
  outerLines.push(limitClause);

  return `WITH _agg AS (\n${innerLines.join('\n')}\n)\n${outerLines.join('\n')}`;
}
