import type { ConsumerLink, LoadedCatalog } from './lineage';

/** Short TTL — cuts repeated loadCatalog / scanConsumers during lineage search debounces. */
export const LINEAGE_CATALOG_TTL_MS = 30_000;
export const LINEAGE_CONSUMERS_TTL_MS = 30_000;

type Entry<T> = { at: number; value: T };

const catalogByKey = new Map<string, Entry<LoadedCatalog>>();
const consumersByOrg = new Map<string, Entry<ConsumerLink[]>>();
const inflightCatalog = new Map<string, Promise<LoadedCatalog | null>>();
const inflightConsumers = new Map<string, Promise<ConsumerLink[]>>();

function catalogKey(orgId: string, modelId: string): string {
  return `${orgId}:${modelId}`;
}

function isFresh<T>(entry: Entry<T> | undefined, ttlMs: number): entry is Entry<T> {
  return !!entry && Date.now() - entry.at < ttlMs;
}

export async function getCachedCatalog(
  orgId: string,
  modelId: string,
  loader: () => Promise<LoadedCatalog | null>,
): Promise<LoadedCatalog | null> {
  const key = catalogKey(orgId, modelId);
  const hit = catalogByKey.get(key);
  if (isFresh(hit, LINEAGE_CATALOG_TTL_MS)) return hit.value;

  let pending = inflightCatalog.get(key);
  if (!pending) {
    pending = loader().then((value) => {
      inflightCatalog.delete(key);
      if (value) catalogByKey.set(key, { at: Date.now(), value });
      else catalogByKey.delete(key);
      return value;
    });
    inflightCatalog.set(key, pending);
  }
  return pending;
}

export async function getCachedConsumers(
  orgId: string,
  loader: () => Promise<ConsumerLink[]>,
): Promise<ConsumerLink[]> {
  const hit = consumersByOrg.get(orgId);
  if (isFresh(hit, LINEAGE_CONSUMERS_TTL_MS)) return hit.value;

  let pending = inflightConsumers.get(orgId);
  if (!pending) {
    pending = loader().then((value) => {
      inflightConsumers.delete(orgId);
      consumersByOrg.set(orgId, { at: Date.now(), value });
      return value;
    });
    inflightConsumers.set(orgId, pending);
  }
  return pending;
}

/** Tests or admin mutations that must see fresh lineage immediately. */
export function clearLineageServerCache(orgId?: string): void {
  if (!orgId) {
    catalogByKey.clear();
    consumersByOrg.clear();
    inflightCatalog.clear();
    inflightConsumers.clear();
    return;
  }
  for (const key of catalogByKey.keys()) {
    if (key.startsWith(`${orgId}:`)) catalogByKey.delete(key);
  }
  consumersByOrg.delete(orgId);
  for (const key of inflightCatalog.keys()) {
    if (key.startsWith(`${orgId}:`)) inflightCatalog.delete(key);
  }
  inflightConsumers.delete(orgId);
}
