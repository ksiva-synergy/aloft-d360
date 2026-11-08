import { decideLevel } from './engine';
import { getAccessModel } from './model-store';
import type { AccessLevel, AccessPrincipal } from './types';

const MAX_CACHE = 500;

type CacheKey = string;

function cacheKey(principal: AccessPrincipal, level: AccessLevel, version: bigint): CacheKey {
  if (principal.kind === 'system') {
    return `sys:${principal.systemKind}:${principal.orgId}:${level}:${version}`;
  }
  return `u:${principal.userId}:${(principal.roles ?? []).join(',')}:${principal.orgId}:${level}:${version}`;
}

class LruCache<V> {
  private map = new Map<CacheKey, V>();

  constructor(private readonly max: number) {}

  get(key: CacheKey): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: CacheKey, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

const pathSetCache = new LruCache<Set<string>>(MAX_CACHE);
const idListCache = new LruCache<string[]>(MAX_CACHE);

export async function visiblePathsSet(
  principal: AccessPrincipal,
  level: AccessLevel,
  objectPaths: string[],
): Promise<Set<string>> {
  const { model, version } = await getAccessModel(principal.orgId);
  const key = `${cacheKey(principal, level, version)}:${objectPaths.length}`;
  const cached = pathSetCache.get(key);
  if (cached) return cached;

  const visible = new Set<string>();
  for (const path of objectPaths) {
    const d = decideLevel(model, principal, path, level);
    if (d.allowed) visible.add(path.toLowerCase());
  }
  pathSetCache.set(key, visible);
  return visible;
}

export async function visibleObjectIds(
  principal: AccessPrincipal,
  level: AccessLevel,
  objects: Array<{ id: string; full_path: string }>,
): Promise<string[]> {
  const { model, version } = await getAccessModel(principal.orgId);
  const key = `${cacheKey(principal, level, version)}:ids:${objects.length}`;
  const cached = idListCache.get(key);
  if (cached) return cached;

  const ids: string[] = [];
  for (const obj of objects) {
    const d = decideLevel(model, principal, obj.full_path, level);
    if (d.allowed) ids.push(obj.id);
  }
  idListCache.set(key, ids);
  return ids;
}

export function evictVisibilityCache(): void {
  pathSetCache.clear();
  idListCache.clear();
}
