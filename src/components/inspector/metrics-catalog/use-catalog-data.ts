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

/**
 * Flatten review + drafts into themed rows. Pure.
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

  return rows;
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
