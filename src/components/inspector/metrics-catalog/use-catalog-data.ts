/**
 * Data layer for the Metrics catalog.
 *
 *  - Session: GET /api/inspector/semantic/models (extended with isAdmin +
 *    currentUserId) → picks the default (governed-preferred) model.
 *  - Per-model rows: GET /[modelId]/review (candidate+governed+archived, with
 *    joins) unioned with GET /my-drafts (owner-scoped drafts, filtered to the
 *    active model). Flattened to per-definition CatalogRow[] + themed.
 *
 * `buildRows` is pure and exported so tests exercise the flatten/theme/draft-join
 * without network. Draft rows have no `full_path` of their own (it lives only on
 * platform_sem_entities) so they join to their parent entity's path via
 * `entityId` from the review payload; a draft on a draft-only entity falls back
 * to the entity label.
 */
import { useCallback, useEffect } from 'react';
import { useCatalogStore } from './catalog-store';
import {
  type CatalogRow,
  type CatalogSession,
  type DefKind,
  type GovStatus,
  nodeIdFor,
} from './catalog-types';
import { deriveTheme } from './catalog-themes';

// ── Loose shapes of the endpoints we read (only the fields we consume) ───────
interface ReviewDim {
  id: string;
  column_name: string;
  dimension_label: string;
  dimension_type?: string;
  description?: string | null;
  synonyms?: string[];
  status: string;
  created_by?: string | null;
  updated_at?: string;
}
interface ReviewMeasure {
  id: string;
  column_name?: string | null;
  measure_label: string;
  aggregate?: string;
  expression?: string | null;
  metric_type?: string;
  unit?: string | null;
  description?: string | null;
  synonyms?: string[];
  status: string;
  created_by?: string | null;
  updated_at?: string;
}
interface ReviewEntity {
  id: string;
  entity_label: string;
  full_path: string;
  description?: string | null;
  synonyms?: string[];
  status: string;
  created_by?: string | null;
  updated_at?: string;
  dimensions: ReviewDim[];
  measures: ReviewMeasure[];
  joins: unknown[];
}
export interface ReviewResponse {
  model: { id: string; name: string; status: string };
  entities: ReviewEntity[];
}

interface DraftGroup {
  modelId: string;
  entityId: string;
  entityLabel: string;
  dimensions: ReviewDim[];
  measures: ReviewMeasure[];
}
export interface MyDraftsResponse {
  entities: DraftGroup[];
}

const asStatus = (s: string): GovStatus =>
  s === 'governed' || s === 'candidate' || s === 'draft' || s === 'archived' ? s : 'candidate';

function themed(
  base: Omit<CatalogRow, 'theme' | 'themeOverridden' | 'rowKey' | 'nodeId'>,
): CatalogRow {
  const rowKey = `${base.kind}:${base.id}`;
  const { theme, overridden } = deriveTheme({
    rowKey,
    kind: base.kind,
    label: base.label,
    synonyms: base.synonyms,
    dimensionType: base.dimensionType,
    metricType: base.metricType,
  });
  return { ...base, rowKey, nodeId: nodeIdFor(base.kind, base.id), theme, themeOverridden: overridden };
}

function dimRow(d: ReviewDim, entity: { id: string; label: string; fullPath: string }, forceDraft: boolean, me: string | null): CatalogRow {
  return themed({
    id: d.id,
    kind: 'dimension' as DefKind,
    label: d.dimension_label,
    status: forceDraft ? 'draft' : asStatus(d.status),
    description: d.description ?? null,
    synonyms: d.synonyms ?? [],
    entityId: entity.id,
    entityLabel: entity.label,
    fullPath: entity.fullPath,
    column: d.column_name ?? null,
    createdBy: forceDraft ? (d.created_by ?? me) : d.created_by ?? null,
    updatedAt: d.updated_at ?? '',
    dimensionType: d.dimension_type,
    isDraft: forceDraft,
  });
}

function measRow(m: ReviewMeasure, entity: { id: string; label: string; fullPath: string }, forceDraft: boolean, me: string | null): CatalogRow {
  return themed({
    id: m.id,
    kind: 'measure' as DefKind,
    label: m.measure_label,
    status: forceDraft ? 'draft' : asStatus(m.status),
    description: m.description ?? null,
    synonyms: m.synonyms ?? [],
    entityId: entity.id,
    entityLabel: entity.label,
    fullPath: entity.fullPath,
    column: m.column_name ?? null,
    createdBy: forceDraft ? (m.created_by ?? me) : m.created_by ?? null,
    updatedAt: m.updated_at ?? '',
    metricType: m.metric_type,
    aggregate: m.aggregate,
    unit: m.unit ?? null,
    expression: m.expression ?? null,
    isDraft: forceDraft,
  });
}

// ── Similarity clustering ────────────────────────────────────────────────────

/**
 * Longest common prefix length between two strings (word-boundary aware).
 * Returns the number of characters in the shared leading segment.
 */
function lcp(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Longest common suffix length between two strings.
 */
function lcs(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Cluster rows within an entity group whose labels share a long common
 * prefix OR suffix (>= 60% of the shorter label). Clusters with 3+ members
 * get a clusterId and a clusterLabel (the shared stem, trimmed).
 *
 * This is intentionally approximate — the goal is visual grouping of
 * obviously-related names like "24hr AE FOHS Consumption" / "24hr MF FOHS
 * Consumption" / "24hr Total FOHS Consumption", not semantic dedup.
 */
function clusterByEntity(rows: CatalogRow[]): CatalogRow[] {
  // Group non-entity rows by entityId
  const byEntity = new Map<string, CatalogRow[]>();
  const entityRows: CatalogRow[] = [];

  for (const r of rows) {
    if (r.kind === 'entity') {
      entityRows.push(r);
      continue;
    }
    const bucket = byEntity.get(r.entityId) ?? [];
    bucket.push(r);
    byEntity.set(r.entityId, bucket);
  }

  let clusterSeq = 0;
  const result: CatalogRow[] = [...entityRows];

  for (const [, members] of byEntity) {
    if (members.length < 3) {
      result.push(...members);
      continue;
    }

    // Build a union-find structure to merge rows that are similar to at least one other
    const parent = members.map((_, i) => i);
    const findRoot = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    const merge = (x: number, y: number) => {
      parent[findRoot(x)] = findRoot(y);
    };

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const la = members[i]!.label;
        const lb = members[j]!.label;
        const shorter = Math.min(la.length, lb.length);
        if (shorter < 6) continue;
        const threshold = Math.ceil(shorter * 0.6);
        if (lcp(la, lb) >= threshold || lcs(la, lb) >= threshold) {
          merge(i, j);
        }
      }
    }

    // Collect groups
    const groups = new Map<number, CatalogRow[]>();
    for (let i = 0; i < members.length; i++) {
      const root = findRoot(i);
      const g = groups.get(root) ?? [];
      g.push(members[i]!);
      groups.set(root, g);
    }

    for (const group of groups.values()) {
      if (group.length < 3) {
        result.push(...group);
        continue;
      }

      // Compute the shared stem: try prefix first, then suffix
      let stem = group[0]!.label;
      for (const r of group.slice(1)) {
        const prefixLen = lcp(stem, r.label);
        const suffixLen = lcs(stem, r.label);
        if (prefixLen >= suffixLen) {
          stem = stem.slice(0, prefixLen).trim().replace(/[_\-,]+$/, '').trim();
        } else {
          stem = stem.slice(stem.length - suffixLen).trim().replace(/^[_\-,]+/, '').trim();
        }
      }
      if (!stem || stem.length < 3) stem = group[0]!.label;

      const clusterId = `cluster-${++clusterSeq}`;
      const clusterSize = group.length;

      // Synthetic parent row (the collapsed cluster header)
      const rep = group[0]!;
      const parentRow: CatalogRow = {
        ...rep,
        rowKey: `cluster:${clusterId}`,
        clusterId,
        clusterLabel: stem,
        isClusterParent: true,
        clusterSize,
        label: stem,
      };
      result.push(parentRow);

      // Tag each child
      for (const r of group) {
        result.push({ ...r, clusterId, clusterLabel: stem, isClusterParent: false });
      }
    }
  }

  return result;
}

/**
 * Flatten review + drafts into themed rows. Pure.
 * After flattening: (1) dedup by rowKey preferring non-draft, (2) cluster similar labels.
 */
export function buildRows(
  review: ReviewResponse | null,
  drafts: MyDraftsResponse | null,
  activeModelId: string | null,
  me: string | null,
): CatalogRow[] {
  const rows: CatalogRow[] = [];
  const entityPathById = new Map<string, { id: string; label: string; fullPath: string }>();

  if (review) {
    for (const e of review.entities) {
      const ent = { id: e.id, label: e.entity_label, fullPath: e.full_path };
      entityPathById.set(e.id, ent);
      // entity row (composition counts)
      rows.push(
        themed({
          id: e.id,
          kind: 'entity',
          label: e.entity_label,
          status: asStatus(e.status),
          description: e.description ?? null,
          synonyms: e.synonyms ?? [],
          entityId: e.id,
          entityLabel: e.entity_label,
          fullPath: e.full_path,
          column: null,
          createdBy: e.created_by ?? null,
          updatedAt: e.updated_at ?? '',
          dCount: e.dimensions.length,
          mCount: e.measures.length,
          jCount: e.joins.length,
          isDraft: false,
        }),
      );
      for (const d of e.dimensions) rows.push(dimRow(d, ent, false, me));
      for (const m of e.measures) rows.push(measRow(m, ent, false, me));
    }
  }

  if (drafts) {
    for (const g of drafts.entities) {
      if (activeModelId && g.modelId !== activeModelId) continue; // scope to active model
      const ent =
        entityPathById.get(g.entityId) ??
        { id: g.entityId, label: g.entityLabel, fullPath: g.entityLabel }; // draft-only entity fallback
      for (const d of g.dimensions) rows.push(dimRow(d, ent, true, me));
      for (const m of g.measures) rows.push(measRow(m, ent, true, me));
    }
  }

  // Phase A: dedup by rowKey — prefer the non-draft version when both exist
  const seen = new Map<string, CatalogRow>();
  for (const r of rows) {
    const existing = seen.get(r.rowKey);
    if (!existing || (existing.isDraft && !r.isDraft)) {
      seen.set(r.rowKey, r);
    }
  }
  const deduped = [...seen.values()];

  // Phase B: similarity clustering
  return clusterByEntity(deduped);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}

/**
 * Loads the session (models + role) once, then the active model's rows on every
 * model switch. Returns `reload` for post-mutation reconcile.
 */
export function useCatalogData() {
  const activeModelId = useCatalogStore((s) => s.activeModelId);
  const session = useCatalogStore((s) => s.session);
  const setSession = useCatalogStore((s) => s.setSession);
  const setActiveModel = useCatalogStore((s) => s.setActiveModel);
  const setRows = useCatalogStore((s) => s.setRows);
  const setLoading = useCatalogStore((s) => s.setLoading);
  const setError = useCatalogStore((s) => s.setError);

  // 1) session
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJson<CatalogSession>('/api/inspector/semantic/models')
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        const pick = s.defaultModelId ?? s.models[0]?.id ?? null;
        const governed = s.models.find((m) => m.id === pick)?.status === 'governed';
        setActiveModel(pick, governed);
        if (!pick) setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load models');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) rows for the active model
  const loadRows = useCallback(
    async (modelId: string) => {
      const me = session?.currentUserId ?? null;
      setLoading(true);
      setError(null);
      try {
        const [review, drafts] = await Promise.all([
          getJson<ReviewResponse>(`/api/inspector/semantic/${modelId}/review`),
          getJson<MyDraftsResponse>('/api/inspector/semantic/my-drafts').catch(() => null),
        ]);
        setRows(buildRows(review, drafts, modelId, me));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load definitions');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [session, setLoading, setError, setRows],
  );

  useEffect(() => {
    if (!activeModelId) return;
    void loadRows(activeModelId);
  }, [activeModelId, loadRows]);

  const reload = useCallback(() => {
    if (activeModelId) return loadRows(activeModelId);
    return Promise.resolve();
  }, [activeModelId, loadRows]);

  return { reload };
}
