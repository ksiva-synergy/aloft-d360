import type { ObjectT2Context } from './object-t2-context';
import type {
  ClusterProposal,
  HeuristicDimension,
  HeuristicEntity,
  HeuristicJoin,
  HeuristicMeasure,
  TableProposal,
} from './proposal-types';

const MEASURE_ROLES = new Set(['measure']);
const DIMENSION_ROLES = new Set(['key', 'dimension', 'timestamp', 'audit', 'text_blob', 'fk_ref', 'flag', 'other']);

function humanizeTableName(objectName: string): string {
  return objectName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function entityLabelFromContext(ctx: ObjectT2Context): string {
  const card = ctx.card;
  const entity = typeof card?.entity === 'string' ? card.entity.trim() : '';
  if (entity) {
    return entity.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  if (ctx.object_name) return humanizeTableName(ctx.object_name);
  return ctx.full_path.split('.').pop() ?? 'Entity';
}

export function descriptionFromContext(ctx: ObjectT2Context): string | null {
  const summary = ctx.card?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

function resolveTargetPath(
  likelyTarget: string,
  paths: Set<string>,
  catalog: string,
  schema: string,
): string | null {
  const t = likelyTarget.trim();
  if (paths.has(t)) return t;
  const qualified = `${catalog}.${schema}.${t.split('.').pop()}`;
  if (paths.has(qualified)) return qualified;
  const twoPart = t.includes('.') ? t : `${schema}.${t}`;
  if (paths.has(twoPart)) return twoPart;
  const threePart = twoPart.includes('.') && !twoPart.startsWith(`${catalog}.`)
    ? `${catalog}.${twoPart}`
    : twoPart;
  if (paths.has(threePart)) return threePart;
  return null;
}

function dimensionTypeForRole(role: string): string {
  if (role === 'timestamp') return 'temporal';
  if (role === 'key' || role === 'fk_ref') return 'identifier';
  return 'categorical';
}

function labelFromColumn(name: string, semantic: Record<string, unknown> | null): string {
  const desc = typeof semantic?.description === 'string' ? semantic.description.trim() : '';
  if (desc) return desc;
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** In-memory proposal (current T4 worker logic, no DB). */
export function heuristicClusterProposal(
  contexts: ObjectT2Context[],
  catalog: string,
  schema: string,
): { entities: HeuristicEntity[]; joins: HeuristicJoin[] } {
  const paths = new Set(contexts.map(c => c.full_path));
  const entities: HeuristicEntity[] = contexts.map(ctx => ({
    full_path: ctx.full_path,
    entity_label: entityLabelFromContext(ctx),
    description: descriptionFromContext(ctx),
  }));

  const joins: HeuristicJoin[] = [];
  const seenJoins = new Set<string>();

  for (const ctx of contexts) {
    const fkCandidates = Array.isArray(ctx.card?.fk_candidates) ? ctx.card!.fk_candidates : [];
    for (const raw of fkCandidates) {
      if (!raw || typeof raw !== 'object') continue;
      const col = typeof (raw as { column?: string }).column === 'string'
        ? (raw as { column: string }).column
        : null;
      const target = typeof (raw as { likely_target?: string }).likely_target === 'string'
        ? (raw as { likely_target: string }).likely_target
        : null;
      if (!col || !target) continue;
      const targetPath = resolveTargetPath(target, paths, catalog, schema);
      if (!targetPath || targetPath === ctx.full_path) continue;
      const joinKey = [ctx.full_path, targetPath].sort().join('|');
      if (seenJoins.has(joinKey)) continue;
      seenJoins.add(joinKey);
      joins.push({
        from_path: ctx.full_path,
        to_path: targetPath,
        join_on_sql: `${ctx.full_path}.${col} = ${targetPath}.id`,
      });
    }
  }

  return { entities, joins };
}

export function heuristicTableProposal(ctx: ObjectT2Context): {
  dimensions: HeuristicDimension[];
  measures: HeuristicMeasure[];
} {
  const cardMeasures = Array.isArray(ctx.card?.measures) ? (ctx.card!.measures as string[]) : [];
  const dimensions: HeuristicDimension[] = [];
  const measures: HeuristicMeasure[] = [];

  for (const col of ctx.columns) {
    const sem = col.semantic ?? {};
    const role = typeof sem.role === 'string' ? sem.role : 'other';
    const label = labelFromColumn(col.name, sem);
    const isMeasure = MEASURE_ROLES.has(role) || cardMeasures.includes(col.name);

    if (isMeasure) {
      measures.push({ column_name: col.name, measure_label: label, aggregate: 'sum' });
      continue;
    }
    if (!DIMENSION_ROLES.has(role)) continue;
    dimensions.push({
      column_name: col.name,
      dimension_label: label,
      dimension_type: dimensionTypeForRole(role),
    });
  }

  return { dimensions, measures };
}

export function toClusterProposal(
  contexts: ObjectT2Context[],
  catalog: string,
  schema: string,
): ClusterProposal {
  const { entities, joins } = heuristicClusterProposal(contexts, catalog, schema);
  return {
    entities,
    joins: joins.map(j => ({ ...j, description: 'Proposed from T2 FK hints' })),
  };
}

export function toTableProposal(ctx: ObjectT2Context): TableProposal {
  const { dimensions, measures } = heuristicTableProposal(ctx);
  return {
    full_path: ctx.full_path,
    dimensions,
    measures: measures.map(m => ({ ...m, metric_type: 'simple' })),
  };
}
