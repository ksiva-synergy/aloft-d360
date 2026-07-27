/**
 * Shared types + client-safe constants for the Metrics catalog surface.
 *
 * This file is imported by both client components and the pure theme/store
 * modules, so it must NOT import anything that pulls in server-only code
 * (prisma, next/server). The lineage node-id format is mirrored here from
 * `@/lib/semantic/lineage` (estateNodeId/dimNodeId/measNodeId) rather than
 * imported, because that module imports prisma and would poison the client
 * bundle. Keep these two in sync — they key the `lineage?focus=` request.
 */

export type DefKind = 'entity' | 'measure' | 'dimension';

/** Governance lifecycle status carried per definition. */
export type GovStatus = 'draft' | 'candidate' | 'governed' | 'archived';

export type Lens = 'govern' | 'explore';

export type CoverageMode = 'bars' | 'treemap';

/** Sortable table columns (superset across both lenses). */
export type SortCol =
  | 'label'
  | 'kind'
  | 'status'
  | 'theme'
  | 'source'
  | 'composition'
  | 'updated';

export interface SortState {
  col: SortCol;
  dir: 'asc' | 'desc';
}

/**
 * One flattened catalog row = one definition (entity, measure, or dimension).
 * The mockup's table is per-definition (Type-colored), so we flatten the
 * review/my-drafts entity trees into rows and virtualize.
 */
export interface CatalogRow {
  /** Definition id (entity/dimension/measure id). Unique within its kind; the
   *  table keys on `${kind}:${id}` since ids are only unique per table. */
  id: string;
  rowKey: string; // `${kind}:${id}` — stable virtualization + selection key
  kind: DefKind;
  /** Lineage focus node id (`e:`/`dim:`/`meas:`) — mirrors lineage.ts helpers. */
  nodeId: string;
  label: string;
  status: GovStatus;
  description: string | null;
  synonyms: string[];

  entityId: string;
  entityLabel: string;
  /** catalog.schema.table from the parent entity (drafts join via entityId). */
  fullPath: string;
  /** Physical column (dims/measures) or null for derived measures / entities. */
  column: string | null;

  theme: string;
  themeOverridden: boolean;

  createdBy: string | null; // NULL = system/T4-generated → admin-only actions
  updatedAt: string; // ISO — surfaced as "Updated" (no verified-at column exists)

  /** Entity rows only: composition counts (Dimensions / Measures / Joins). */
  dCount?: number;
  mCount?: number;
  jCount?: number;

  /** Type-specific metadata (used for theming + Explore "Definition" cell). */
  dimensionType?: string; // dimensions
  metricType?: string; // measures
  aggregate?: string; // measures
  unit?: string | null; // measures
  expression?: string | null; // derived measures

  /** True when the row came from the owner-scoped my-drafts overlay. */
  isDraft: boolean;

  /** Similarity cluster: rows with the same clusterId form a group (entityId-scoped). */
  clusterId?: string;
  /** Human-readable stem shared by all rows in the cluster (e.g. "FOHS Consumption"). */
  clusterLabel?: string;
  /** True on the synthetic header row that represents the collapsed cluster. */
  isClusterParent?: boolean;
  /** Number of children when isClusterParent is true. */
  clusterSize?: number;
}

// ── Node-id mirror (keep in sync with src/lib/semantic/lineage.ts) ───────────
export const estateNode = (entityId: string) => `e:${entityId}`;
export const dimNode = (id: string) => `dim:${id}`;
export const measNode = (id: string) => `meas:${id}`;

export const nodeIdFor = (kind: DefKind, id: string): string =>
  kind === 'entity' ? estateNode(id) : kind === 'dimension' ? dimNode(id) : measNode(id);

// ── Model summary (from /models, extended with role/user identity) ───────────
export interface ModelSummary {
  id: string;
  name: string;
  status: GovStatus | string;
}

export interface CatalogSession {
  models: ModelSummary[];
  defaultModelId: string | null;
  /** Org-global admin override (see promotion-gate.isAdmin). */
  isAdmin: boolean;
  /** Current user id, for per-row `created_by` ownership emphasis. */
  currentUserId: string | null;
}
