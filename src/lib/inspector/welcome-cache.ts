import prisma from '@/lib/db';
import { isTestSourceDisplayName } from '@/lib/context/test-sources';
import type { WelcomeCatalog, WelcomeObject } from '@/lib/inspector/welcome-catalog';
import { parseObjectSemanticCard } from '@/lib/inspector/welcome-semantics';
import type { WelcomeDepartmentDef } from '@/lib/inspector/welcome-departments';

import { buildWelcomeCatalog } from '@/lib/inspector/welcome-catalog';

/**
 * In-memory caches for GET /api/inspector/welcome and domain focus.
 *
 * One org-wide snapshot (active objects + latest T2 cards + department paths) and one built
 * WelcomeCatalog per org. Same catalog for every signed-in user; SQL/discover access is still
 * enforced on query. Inputs change only when harvest or department paths change — stale-while-
 * revalidate: fresh for BASE_FRESH_MS, background refresh until BASE_MAX_STALE_MS.
 *
 * Call evictWelcomeCache(orgId) after harvest jobs or department path edits for immediate refresh.
 */

const BASE_FRESH_MS = 5 * 60_000;
const BASE_MAX_STALE_MS = 30 * 60_000;
const CATALOG_FRESH_MS = BASE_FRESH_MS;
const CATALOG_MAX_STALE_MS = BASE_MAX_STALE_MS;

export interface WelcomeBaseObject {
  id: string;
  full_path: string;
  welcome: WelcomeObject;
}

export interface WelcomeBase {
  objects: WelcomeBaseObject[];
  departments: WelcomeDepartmentDef[];
}

interface Entry<T> {
  value?: T;
  at: number;
  pending?: Promise<T>;
}

function refresh<T>(entry: Entry<T>, load: () => Promise<T>): Promise<T> {
  if (!entry.pending) {
    entry.pending = load()
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
        return value;
      })
      .finally(() => {
        entry.pending = undefined;
      });
  }
  return entry.pending;
}

/** Stale-while-revalidate read with in-flight de-duplication. */
async function swr<T>(
  map: Map<string, Entry<T>>,
  key: string,
  freshMs: number,
  maxStaleMs: number,
  load: () => Promise<T>,
  maxEntries = Infinity,
): Promise<T> {
  let entry = map.get(key);
  if (!entry) {
    entry = { at: 0 };
    map.set(key, entry);
    if (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined && oldest !== key) map.delete(oldest);
    }
  }
  const age = Date.now() - entry.at;
  if (entry.value !== undefined && age < freshMs) return entry.value;
  if (entry.value !== undefined && age < maxStaleMs) {
    // Background refresh; a failure keeps serving the stale value.
    refresh(entry, load).catch((err) => console.error('[inspector/welcome cache refresh]', err));
    return entry.value;
  }
  return refresh(entry, load);
}

const baseCache = new Map<string, Entry<WelcomeBase>>();
const catalogCache = new Map<string, Entry<WelcomeCatalog>>();

async function loadBase(orgId: string): Promise<WelcomeBase> {
  const [objects, deptRows, pathRows, cardRows] = await Promise.all([
    prisma.platformContextObject.findMany({
      where: { org_id: orgId, lifecycle: 'active' },
      select: {
        id: true,
        full_path: true,
        catalog_name: true,
        schema_name: true,
        object_name: true,
        domain_keywords: true,
        row_count_est: true,
        last_t0_at: true,
        last_t3_at: true,
        source: { select: { display_name: true } },
      },
    }),
    prisma.accessDataDepartment.findMany({
      where: { org_id: orgId, archived_at: null },
      select: { id: true, key: true, name: true },
    }),
    prisma.accessDepartmentPath.findMany({
      where: { org_id: orgId },
      select: { department_id: true, path: true },
    }),
    // One org-scoped scan instead of an IN (…thousands of ids…) list; newest version first.
    prisma.platformContextSemantic.findMany({
      where: { org_id: orgId, subject_kind: 'object' },
      orderBy: { version: 'desc' },
      select: { subject_id: true, card: true },
    }),
  ]);

  const pathsByDept = new Map<string, string[]>();
  for (const p of pathRows) {
    const list = pathsByDept.get(p.department_id);
    if (list) list.push(p.path);
    else pathsByDept.set(p.department_id, [p.path]);
  }
  const departments: WelcomeDepartmentDef[] = deptRows.map((d) => ({
    key: d.key,
    name: d.name,
    paths: pathsByDept.get(d.id) ?? [],
  }));

  const semanticById = new Map<string, ReturnType<typeof parseObjectSemanticCard>>();
  for (const row of cardRows) {
    if (!semanticById.has(row.subject_id)) {
      semanticById.set(row.subject_id, parseObjectSemanticCard(row.card));
    }
  }

  const production = objects.filter((o) => !isTestSourceDisplayName(o.source.display_name));
  return {
    departments,
    objects: production.map((o) => ({
      id: o.id,
      full_path: o.full_path,
      welcome: {
        full_path: o.full_path,
        catalog_name: o.catalog_name,
        schema_name: o.schema_name,
        object_name: o.object_name,
        domain_keywords: o.domain_keywords ?? [],
        last_t0_at: o.last_t0_at,
        row_count_est: o.row_count_est != null ? Number(o.row_count_est) : null,
        has_t3: o.last_t3_at != null,
        semantic: semanticById.get(o.id),
      },
    })),
  };
}

export function getWelcomeBase(orgId: string): Promise<WelcomeBase> {
  return swr(baseCache, orgId, BASE_FRESH_MS, BASE_MAX_STALE_MS, () => loadBase(orgId));
}

/** Org-wide Inspector welcome (domain cards + starter questions). */
export function getOrgWelcomeCatalog(orgId: string, maxAreas = 12): Promise<WelcomeCatalog> {
  return swr(
    catalogCache,
    orgId,
    CATALOG_FRESH_MS,
    CATALOG_MAX_STALE_MS,
    async () => {
      const base = await getWelcomeBase(orgId);
      return buildWelcomeCatalog(
        base.objects.map((o) => o.welcome),
        { departments: base.departments, maxAreas },
      );
    },
  );
}

/** Drop cached welcome data for one org, or all orgs when orgId is omitted. */
export function evictWelcomeCache(orgId?: string): void {
  if (!orgId) {
    baseCache.clear();
    catalogCache.clear();
    return;
  }
  baseCache.delete(orgId);
  catalogCache.delete(orgId);
}
