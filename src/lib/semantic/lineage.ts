/**
 * src/lib/semantic/lineage.ts
 *
 * Server-side builder for the Entities catalog + Lineage graph surfaces.
 * Pinned against real code in docs/inspector-guided/entities-lineage-phase0-pins.md.
 *
 * Hard boundaries this module keeps:
 *  - Governed-only lens: only a `governed` model is queryable; within it, defs of
 *    status NOT IN ('archived','draft') are surfaced (candidate + governed), with
 *    per-def `status` carried so the UI can distinguish them. (Pin #3)
 *  - Estate resolution is MODEL-SIDE: entity.full_path + def.column_name/expression,
 *    never SQL-string parsing. (Pin #1)
 *  - The compiled-SQL peek uses compileSemanticQuery (PURE — no execution). No new
 *    SQL path is opened; executeDatabricksSQL stays the only execution route.
 *  - Candidate propagation is a UX rollup over real per-def status, NOT an execution
 *    gate. Rendered as an explicit state, never a 500. (Pin #3)
 *  - No SCD fields are surfaced — none exist in the schema. (Pin #4)
 *  - Org scope via getDefaultOrg() only; single-org assumption preserved.
 */

import prisma from '@/lib/db';
import { compileSemanticQuery, toAlias } from './compiler';
import type { SemanticModel } from './types';
import {
  isSemanticWidget,
  type WidgetSpec,
} from '@/lib/dashboards/types';

// ── Public payload types ────────────────────────────────────────────────────

export type NodeKind = 'estate' | 'dimension' | 'measure' | 'consumer';

/** How a def resolves to a concrete source location (Pin #1). */
export interface ResolvesTo {
  /** catalog.schema.table (platform_sem_entities.full_path — a single canonical string). */
  fullPath: string;
  /** platform_sem_dimensions/measures.column_name — null for derived/ratio measures. */
  column: string | null;
  /** platform_sem_measures.expression — set only for derived/ratio measures. */
  expression: string | null;
  /**
   * The result-column KEY rows come back under (toAlias(label)). Distinct from
   * `column` (the source field) so an alias-vs-label mismatch is visible, not
   * silently empty (false-green trap b).
   */
  resultAlias: string;
}

export interface EstateNode {
  id: string; // `e:<entityId>`
  kind: 'estate';
  entityId: string;
  label: string; // entity_label
  fullPath: string; // catalog.schema.table
  status: string;
}

export interface DefNode {
  id: string; // `dim:<id>` | `meas:<id>`
  kind: 'dimension' | 'measure';
  defId: string;
  entityId: string;
  label: string;
  status: string;
  resolvesTo: ResolvesTo;
  classification: {
    synonyms: string[];
    aiContext: string | null;
    description: string | null;
    /** dimension_type (categorical/temporal/…) — the closest thing to the prototype's "type". */
    dimensionType?: string;
    /** metric_type (simple/ratio/derived/cumulative) for measures. */
    metricType?: string;
    aggregate?: string;
    unit?: string | null;
    formatHint?: string | null;
  };
  /** Read-only compiled-SQL peek (trust spine) — measures only, PURE (no execution). */
  compiledSql?: string;
  /** Governance ceiling (Pin #3 rollup) — true when this metric's chain touches a candidate def. */
  capped?: boolean;
  /** Node ids of the candidate defs that cap this metric (honest, explicit). */
  cappedBy?: string[];
}

export interface ConsumerNode {
  id: string; // `dash:<dashboardId>`
  kind: 'consumer';
  dashboardId: string;
  label: string; // dashboard name
  visibility: string;
  /** Whether the dashboard's own model is governed (else the dashboard reads as a UX state). */
  modelGoverned: boolean;
}

export type LineageNode = EstateNode | DefNode | ConsumerNode;

export type EdgeKind = 'membership' | 'join' | 'consumes';

export interface LineageEdge {
  from: string; // node id
  to: string; // node id
  kind: EdgeKind;
  /** Dashed in the UI when an endpoint def is candidate (governance-lens signal). */
  candidate?: boolean;
  /** join_on_sql for join edges — the actual join keys (Pin #2). */
  joinKeys?: string;
}

export interface LineageGraph {
  model: { id: string; name: string; status: string };
  nodes: LineageNode[];
  edges: LineageEdge[];
  /**
   * First-class contract absence: which prototype columns have NO backing in the
   * real model (source-system linkage, SCD) so they are deliberately, VISIBLY
   * absent in the endpoint output — not a silently-missing key. See `Omission`.
   */
  omissions: Omission[];
}

// ── Node id helpers ─────────────────────────────────────────────────────────

export const estateNodeId = (entityId: string) => `e:${entityId}`;
export const dimNodeId = (id: string) => `dim:${id}`;
export const measNodeId = (id: string) => `meas:${id}`;
export const consumerNodeId = (dashboardId: string) => `dash:${dashboardId}`;

// ── Catalog load ──────────────────────────────────────────────────────────────

export interface LoadedCatalog {
  model: { id: string; name: string; status: string };
  entities: {
    id: string;
    full_path: string;
    entity_label: string;
    description: string | null;
    ai_context: string | null;
    synonyms: string[];
    status: string;
  }[];
  dimensions: {
    id: string;
    entity_id: string;
    column_name: string;
    dimension_label: string;
    dimension_type: string;
    description: string | null;
    ai_context: string | null;
    synonyms: string[];
    format_hint: string | null;
    status: string;
  }[];
  measures: {
    id: string;
    entity_id: string;
    column_name: string | null;
    measure_label: string;
    aggregate: string;
    expression: string | null;
    metric_type: string;
    description: string | null;
    ai_context: string | null;
    synonyms: string[];
    unit: string | null;
    format_hint: string | null;
    status: string;
  }[];
  joins: {
    id: string;
    from_entity_id: string;
    to_entity_id: string;
    join_type: string;
    join_on_sql: string;
  }[];
}

/**
 * Resolve the org's single governed semantic model. Returns null when none is
 * governed yet (an explicit UX state, not an error).
 */
export async function resolveGovernedModel(
  orgId: string,
): Promise<{ id: string; name: string; status: string } | null> {
  const model = await prisma.platform_semantic_models.findFirst({
    where: { org_id: orgId, status: 'governed' },
    select: { id: true, name: true, status: true },
    orderBy: { created_at: 'desc' },
  });
  return model;
}

/**
 * Load the governed model's catalog: entities + dims + measures + joins.
 * Mirrors the definitions-route filter — entities filtered FIRST (so a
 * non-archived def inside an archived/draft entity cannot leak), then dims/
 * measures scoped to the surviving entity ids, all NOT IN ('archived','draft').
 */
export async function loadCatalog(
  orgId: string,
  modelId: string,
): Promise<LoadedCatalog | null> {
  const model = await prisma.platform_semantic_models.findFirst({
    where: { id: modelId, org_id: orgId, status: 'governed' },
    select: { id: true, name: true, status: true },
  });
  if (!model) return null;

  const entities = await prisma.platform_sem_entities.findMany({
    where: { model_id: modelId, org_id: orgId, status: { notIn: ['archived', 'draft'] } },
    orderBy: { created_at: 'asc' },
  });
  const entityIds = entities.map((e) => e.id);

  const [dimensions, measures, joins] = await Promise.all([
    prisma.platform_sem_dimensions.findMany({
      where: { entity_id: { in: entityIds }, org_id: orgId, status: { notIn: ['archived', 'draft'] } },
      orderBy: { created_at: 'asc' },
    }),
    prisma.platform_sem_measures.findMany({
      where: { entity_id: { in: entityIds }, org_id: orgId, status: { notIn: ['archived', 'draft'] } },
      orderBy: { created_at: 'asc' },
    }),
    prisma.platform_sem_joins.findMany({
      where: { model_id: modelId, org_id: orgId },
    }),
  ]);

  return {
    model,
    entities: entities.map((e) => ({
      id: e.id,
      full_path: e.full_path,
      entity_label: e.entity_label,
      description: e.description,
      ai_context: e.ai_context,
      synonyms: e.synonyms,
      status: e.status,
    })),
    dimensions: dimensions.map((d) => ({
      id: d.id,
      entity_id: d.entity_id,
      column_name: d.column_name,
      dimension_label: d.dimension_label,
      dimension_type: d.dimension_type,
      description: d.description,
      ai_context: d.ai_context,
      synonyms: d.synonyms,
      format_hint: d.format_hint,
      status: d.status,
    })),
    measures: measures.map((m) => ({
      id: m.id,
      entity_id: m.entity_id,
      column_name: m.column_name,
      measure_label: m.measure_label,
      aggregate: m.aggregate,
      expression: m.expression,
      metric_type: m.metric_type,
      description: m.description,
      ai_context: m.ai_context,
      synonyms: m.synonyms,
      unit: m.unit,
      format_hint: m.format_hint,
      status: m.status,
    })),
    joins: joins.map((j) => ({
      id: j.id,
      from_entity_id: j.from_entity_id,
      to_entity_id: j.to_entity_id,
      join_type: j.join_type,
      join_on_sql: j.join_on_sql,
    })),
  };
}

// ── Consumer scan (Pin #2 — the def→dashboard edge, one read two directions) ──

export interface ConsumerLink {
  dashboardId: string;
  name: string;
  visibility: string;
  modelGoverned: boolean;
  /** Def ids this dashboard's widgets reference. */
  dimensionIds: Set<string>;
  measureIds: Set<string>;
}

/**
 * Scan every non-deleted dashboard's CURRENT version widgets and collect the def
 * ids each one references via SemanticWidgetSpec.semanticQuery. This is the single
 * graph read that powers BOTH directions:
 *   forward  — for def D: dashboards whose {dimensionIds ∪ measureIds} contains D.
 *   reverse  — for dim X: measures co-referenced in a widget that also lists X
 *              (see coReferencedMeasures()).
 * Raw-SQL widgets reference no governed defs and are skipped.
 */
export async function scanConsumers(orgId: string): Promise<ConsumerLink[]> {
  const dashboards = await prisma.platform_dashboards.findMany({
    where: { org_id: orgId, deleted_at: null },
    select: {
      id: true,
      name: true,
      visibility: true,
      current_version_id: true,
      platform_semantic_models: { select: { status: true } },
      platform_dashboard_versions_platform_dashboards_current_version_idToplatform_dashboard_versions: {
        select: { widgets: true },
      },
    },
  });

  const links: ConsumerLink[] = [];
  for (const d of dashboards) {
    const version =
      d.platform_dashboard_versions_platform_dashboards_current_version_idToplatform_dashboard_versions;
    if (!d.current_version_id || !version) continue;

    const widgets = Array.isArray(version.widgets)
      ? (version.widgets as unknown as WidgetSpec[])
      : [];

    const dimensionIds = new Set<string>();
    const measureIds = new Set<string>();
    for (const w of widgets) {
      if (!isSemanticWidget(w) || !w.semanticQuery) continue;
      for (const dr of w.semanticQuery.dimensions ?? []) {
        if (dr?.dimensionId) dimensionIds.add(dr.dimensionId);
      }
      for (const mr of w.semanticQuery.measures ?? []) {
        if (mr?.measureId) measureIds.add(mr.measureId);
      }
    }

    if (dimensionIds.size === 0 && measureIds.size === 0) continue;

    links.push({
      dashboardId: d.id,
      name: d.name,
      visibility: d.visibility,
      modelGoverned: d.platform_semantic_models?.status === 'governed',
      dimensionIds,
      measureIds,
    });
  }
  return links;
}

/**
 * Reverse-direction read (Pin #2): given a dimension id, the measure ids that
 * appear in the SAME widget as that dimension — i.e. "metrics that use X as a
 * dimension". Derived from the same ConsumerLink set as the forward edge.
 */
export function coReferencedMeasures(
  dimensionId: string,
  consumers: ConsumerLink[],
): Set<string> {
  const out = new Set<string>();
  for (const c of consumers) {
    if (c.dimensionIds.has(dimensionId)) {
      for (const m of c.measureIds) out.add(m);
    }
  }
  return out;
}

// ── Compiled-SQL peek (trust spine) — PURE, no execution ──────────────────────

/**
 * Build the SemanticModel shape the compiler needs, from a loaded catalog.
 * Identical mapping to execute.ts:156-186 (kept in sync).
 */
export function toSemanticModel(cat: LoadedCatalog): SemanticModel {
  return {
    id: cat.model.id,
    entities: cat.entities.map((e) => ({
      id: e.id,
      full_path: e.full_path,
      entity_label: e.entity_label,
    })),
    dimensions: cat.dimensions.map((d) => ({
      id: d.id,
      entity_id: d.entity_id,
      column_name: d.column_name,
      dimension_label: d.dimension_label,
      dimension_type: d.dimension_type,
    })),
    measures: cat.measures.map((m) => ({
      id: m.id,
      entity_id: m.entity_id,
      column_name: m.column_name ?? null,
      measure_label: m.measure_label,
      aggregate: m.aggregate,
      expression: m.expression ?? null,
      metric_type: m.metric_type,
    })),
    joins: cat.joins.map((j) => ({
      id: j.id,
      from_entity_id: j.from_entity_id,
      to_entity_id: j.to_entity_id,
      join_type: j.join_type,
      join_on_sql: j.join_on_sql,
    })),
  };
}

/**
 * The read-only compiled-SQL for a single measure (trust-spine peek). Compiles a
 * minimal 1-measure query via compileSemanticQuery — this NEVER executes and opens
 * NO SQL path. Returns null if compilation throws (e.g. a derived measure missing
 * its expression) — surfaced as an explicit "cannot compile" state, not a crash.
 */
export function compiledSqlForMeasure(
  cat: LoadedCatalog,
  measureId: string,
  /** Optional prebuilt model — pass it to avoid re-mapping the whole catalog per call. */
  prebuiltModel?: SemanticModel,
): string | null {
  const model = prebuiltModel ?? toSemanticModel(cat);
  const measure = cat.measures.find((m) => m.id === measureId);
  if (!measure) return null;
  try {
    return compileSemanticQuery(
      {
        modelId: cat.model.id,
        entityId: measure.entity_id,
        dimensions: [],
        measures: [{ measureId }],
        filters: [],
        sorts: [],
      },
      model,
    );
  } catch {
    return null;
  }
}

// ── Graph assembly ────────────────────────────────────────────────────────────

/**
 * A design-assumed field that has NO backing in the real model, surfaced as an
 * explicit contract-level absence rather than a silently-missing key or a
 * plausible empty UI panel. First-class omission: the endpoint OUTPUT names what
 * it cannot resolve. This shape is the reuse contract for future surfaces.
 */
export interface Omission {
  field: string;
  reason: string;
}

const OMISSIONS: Omission[] = [
  {
    field: 'sourceSystem',
    reason: 'no stored link from platform_sem_entities to an ingest source (not modeled)',
  },
  {
    field: 'scd_valid_from_valid_to',
    reason: 'no such fields on any platform_sem_* table (Pin #4 — dropped)',
  },
];

const isCandidate = (status: string) => status === 'candidate';

/**
 * Model-level governance summary. Attaches the bootstrap CONTEXT to the raw
 * candidate/governed counts so a heavily-candidate estate doesn't read as a bug.
 *
 * A newly auto-bootstrapped model is itself governed while nearly all of its defs
 * are still `candidate` (authoring hasn't promoted them yet). That produces a
 * "99% capped" lineage view which is CORRECT, not broken — but only if the reader
 * has the bootstrap context. So we ship the explanation next to the number.
 */
export function governanceSummary(cat: LoadedCatalog) {
  const defs = [...cat.dimensions, ...cat.measures];
  const total = defs.length;
  const governed = defs.filter((d) => d.status === 'governed').length;
  const candidate = defs.filter((d) => isCandidate(d.status)).length;
  const pctCandidate = total ? Math.round((candidate / total) * 100) : 0;
  // ASSUMPTION (recalibrate): 80% is tuned for a fresh auto-bootstrapped model,
  // where nearly all defs are candidate. The day a real governed estate settles at
  // a lower candidate ratio, this threshold will mislabel a normal estate as
  // "bootstrapping". Fine for now; flag/lower it if the ratio ever falls below this.
  const BOOTSTRAP_CANDIDATE_PCT = 80;
  const bootstrapLikely = pctCandidate >= BOOTSTRAP_CANDIDATE_PCT;
  return {
    total,
    governed,
    candidate,
    pctCandidate,
    note: bootstrapLikely
      ? `The model is governed but ${pctCandidate}% of its definitions are still candidate — ` +
        `the expected state of a freshly auto-bootstrapped model where authoring has not yet ` +
        `promoted defs to governed. A heavily-capped lineage view here is correct, not a bug.`
      : undefined,
  };
}

/**
 * Per-measure governance ceiling rollup (Pin #3): candidate defs in the chain
 * {self, own entity, dimensions co-referenced in a consuming widget}. Honest
 * ceiling, NOT an execution gate.
 */
function cappedByFor(
  m: LoadedCatalog['measures'][number],
  entityStatus: string,
  consumers: ConsumerLink[],
  dimStatusById: Map<string, string>,
): string[] {
  const cappedBy: string[] = [];
  if (isCandidate(m.status)) cappedBy.push(measNodeId(m.id));
  if (isCandidate(entityStatus)) cappedBy.push(estateNodeId(m.entity_id));
  const coDims = new Set<string>();
  for (const c of consumers) {
    if (c.measureIds.has(m.id)) for (const dimId of c.dimensionIds) coDims.add(dimId);
  }
  for (const dimId of coDims) {
    if (isCandidate(dimStatusById.get(dimId) ?? '')) cappedBy.push(dimNodeId(dimId));
  }
  return cappedBy;
}

/**
 * Core assembler. `keep` = the node-id set to include; `null` = include the whole
 * model (used only for tiny fixtures / tests — NOT for the populated model, which
 * has ~12k nodes). Builds the SemanticModel ONCE and compiles SQL only for kept
 * measure nodes (never all 3k measures per request).
 */
function assemble(
  cat: LoadedCatalog,
  consumers: ConsumerLink[],
  keep: Set<string> | null,
): LineageGraph {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const entityById = new Map(cat.entities.map((e) => [e.id, e]));
  const dimStatusById = new Map(cat.dimensions.map((d) => [d.id, d.status]));
  const inKeep = (id: string) => keep === null || keep.has(id);
  const model = toSemanticModel(cat); // built ONCE

  for (const e of cat.entities) {
    if (!inKeep(estateNodeId(e.id))) continue;
    nodes.push({ id: estateNodeId(e.id), kind: 'estate', entityId: e.id, label: e.entity_label, fullPath: e.full_path, status: e.status });
  }

  for (const j of cat.joins) {
    if (!entityById.has(j.from_entity_id) || !entityById.has(j.to_entity_id)) continue;
    if (!inKeep(estateNodeId(j.from_entity_id)) || !inKeep(estateNodeId(j.to_entity_id))) continue;
    edges.push({ from: estateNodeId(j.from_entity_id), to: estateNodeId(j.to_entity_id), kind: 'join', joinKeys: j.join_on_sql });
  }

  for (const d of cat.dimensions) {
    if (!inKeep(dimNodeId(d.id))) continue;
    const entity = entityById.get(d.entity_id);
    if (!entity) continue;
    nodes.push({
      id: dimNodeId(d.id), kind: 'dimension', defId: d.id, entityId: d.entity_id, label: d.dimension_label, status: d.status,
      resolvesTo: { fullPath: entity.full_path, column: d.column_name, expression: null, resultAlias: toAlias(d.dimension_label) },
      classification: { synonyms: d.synonyms, aiContext: d.ai_context, description: d.description, dimensionType: d.dimension_type, formatHint: d.format_hint },
    });
    if (inKeep(estateNodeId(d.entity_id))) {
      edges.push({ from: estateNodeId(d.entity_id), to: dimNodeId(d.id), kind: 'membership', candidate: isCandidate(d.status) });
    }
  }

  for (const m of cat.measures) {
    if (!inKeep(measNodeId(m.id))) continue;
    const entity = entityById.get(m.entity_id);
    if (!entity) continue;
    const cappedBy = cappedByFor(m, entity.status, consumers, dimStatusById);
    nodes.push({
      id: measNodeId(m.id), kind: 'measure', defId: m.id, entityId: m.entity_id, label: m.measure_label, status: m.status,
      resolvesTo: { fullPath: entity.full_path, column: m.column_name, expression: m.expression, resultAlias: toAlias(m.measure_label) },
      classification: { synonyms: m.synonyms, aiContext: m.ai_context, description: m.description, metricType: m.metric_type, aggregate: m.aggregate, unit: m.unit, formatHint: m.format_hint },
      compiledSql: compiledSqlForMeasure(cat, m.id, model) ?? undefined,
      capped: cappedBy.length > 0,
      cappedBy: cappedBy.length > 0 ? cappedBy : undefined,
    });
    if (inKeep(estateNodeId(m.entity_id))) {
      edges.push({ from: estateNodeId(m.entity_id), to: measNodeId(m.id), kind: 'membership', candidate: isCandidate(m.status) });
    }
  }

  const referencedDefIds = new Set<string>([...cat.dimensions.map((d) => d.id), ...cat.measures.map((m) => m.id)]);
  for (const c of consumers) {
    if (!inKeep(consumerNodeId(c.dashboardId))) continue;
    const dims = [...c.dimensionIds].filter((id) => referencedDefIds.has(id));
    const meas = [...c.measureIds].filter((id) => referencedDefIds.has(id));
    if (dims.length === 0 && meas.length === 0) continue;
    nodes.push({ id: consumerNodeId(c.dashboardId), kind: 'consumer', dashboardId: c.dashboardId, label: c.name, visibility: c.visibility, modelGoverned: c.modelGoverned });
    for (const id of dims) if (inKeep(dimNodeId(id))) edges.push({ from: dimNodeId(id), to: consumerNodeId(c.dashboardId), kind: 'consumes' });
    for (const id of meas) if (inKeep(measNodeId(id))) edges.push({ from: measNodeId(id), to: consumerNodeId(c.dashboardId), kind: 'consumes' });
  }

  return { model: cat.model, nodes, edges, omissions: OMISSIONS };
}

/**
 * The FULL model graph (keep = null). Only safe for small models / tests — the
 * populated auto-bootstrap model has ~12k nodes; the endpoint uses the focused
 * builder instead.
 */
export function buildLineageGraph(cat: LoadedCatalog, consumers: ConsumerLink[]): LineageGraph {
  return assemble(cat, consumers, null);
}

const DEF_CAP_PER_FOCUS = 120;

/**
 * Compute the bounded node-id neighborhood of a focus node, so the endpoint
 * returns a small subgraph (never the whole 12k-node model). Neighborhood:
 *   - measure focus → the measure, its entity (+ directly joined entities),
 *     consumers referencing it, and dimensions co-referenced in those consumers.
 *   - entity  focus → the entity (+ directly joined entities), its dims + measures
 *     (capped), and consumers referencing any of those defs.
 * Returns { keep, truncated } — truncated=true when the def cap clipped the set.
 */
export function computeNeighborhood(
  cat: LoadedCatalog,
  consumers: ConsumerLink[],
  focusId: string,
): { keep: Set<string>; truncated: boolean } {
  const keep = new Set<string>([focusId]);
  let truncated = false;
  const joinedEntities = (entityId: string) => {
    const out: string[] = [];
    for (const j of cat.joins) {
      if (j.from_entity_id === entityId) out.push(j.to_entity_id);
      else if (j.to_entity_id === entityId) out.push(j.from_entity_id);
    }
    return out;
  };
  const addEntity = (entityId: string) => {
    keep.add(estateNodeId(entityId));
    for (const other of joinedEntities(entityId)) keep.add(estateNodeId(other));
  };

  if (focusId.startsWith('meas:')) {
    const id = focusId.slice(5);
    const m = cat.measures.find((x) => x.id === id);
    if (m) {
      addEntity(m.entity_id);
      for (const c of consumers) {
        if (c.measureIds.has(id)) {
          keep.add(consumerNodeId(c.dashboardId));
          for (const dimId of c.dimensionIds) keep.add(dimNodeId(dimId)); // co-referenced dims (cap lens)
        }
      }
    }
  } else if (focusId.startsWith('dim:')) {
    const id = focusId.slice(4);
    const d = cat.dimensions.find((x) => x.id === id);
    if (d) {
      addEntity(d.entity_id);
      for (const c of consumers) {
        if (c.dimensionIds.has(id)) {
          keep.add(consumerNodeId(c.dashboardId));
          for (const mId of c.measureIds) keep.add(measNodeId(mId)); // reverse: metrics using this dim
        }
      }
    }
  } else if (focusId.startsWith('e:')) {
    const entityId = focusId.slice(2);
    addEntity(entityId);
    let count = 0;
    for (const d of cat.dimensions) {
      if (d.entity_id !== entityId) continue;
      if (count >= DEF_CAP_PER_FOCUS) { truncated = true; break; }
      keep.add(dimNodeId(d.id)); count++;
    }
    for (const m of cat.measures) {
      if (m.entity_id !== entityId) continue;
      if (count >= DEF_CAP_PER_FOCUS) { truncated = true; break; }
      keep.add(measNodeId(m.id)); count++;
    }
    // consumers referencing any kept def of this entity
    for (const c of consumers) {
      const hit = [...c.dimensionIds].some((x) => keep.has(dimNodeId(x))) || [...c.measureIds].some((x) => keep.has(measNodeId(x)));
      if (hit) keep.add(consumerNodeId(c.dashboardId));
    }
  }
  return { keep, truncated };
}

/** Focus-scoped graph — the endpoint's primary path. */
export function buildFocusedGraph(
  cat: LoadedCatalog,
  consumers: ConsumerLink[],
  focusId: string,
): LineageGraph & { focusId: string; truncated: boolean } {
  const { keep, truncated } = computeNeighborhood(cat, consumers, focusId);
  const g = assemble(cat, consumers, keep);
  return { ...g, focusId, truncated };
}

// ── Focus options (light, searchable — never ships the whole model) ───────────

export interface FocusOption {
  id: string; // node id
  label: string;
  kind: 'measure' | 'estate';
  status: string;
}

/**
 * Light list of focusable nodes (measures + entities) for the focus picker.
 * Optional case-insensitive `q` filter and a hard `limit` so the client never
 * receives thousands of options at once. Returns { options, total, hasMore }.
 */
export function listFocusOptions(
  cat: LoadedCatalog,
  opts: { q?: string; limit?: number } = {},
): { options: FocusOption[]; total: number; hasMore: boolean } {
  const q = (opts.q ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const all: FocusOption[] = [
    ...cat.measures.map((m) => ({ id: measNodeId(m.id), label: m.measure_label, kind: 'measure' as const, status: m.status })),
    ...cat.entities.map((e) => ({ id: estateNodeId(e.id), label: e.entity_label, kind: 'estate' as const, status: e.status })),
  ];
  const filtered = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  filtered.sort((a, b) => a.label.localeCompare(b.label));
  return { options: filtered.slice(0, limit), total: filtered.length, hasMore: filtered.length > limit };
}
