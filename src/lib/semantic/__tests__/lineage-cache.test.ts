import { describe, expect, it, vi } from 'vitest';
import {
  clearLineageServerCache,
  getCachedCatalog,
  getCachedConsumers,
  LINEAGE_CATALOG_TTL_MS,
} from '../lineage-cache';
import type { LoadedCatalog } from '../lineage';

const cat: LoadedCatalog = {
  model: { id: 'm1', name: 'Test', status: 'governed' },
  entities: [],
  dimensions: [],
  measures: [],
  joins: [],
};

describe('lineage-cache', () => {
  it('dedupes concurrent catalog loads', async () => {
    clearLineageServerCache('org1');
    const loader = vi.fn().mockImplementation(
      () => new Promise<LoadedCatalog>((resolve) => setTimeout(() => resolve(cat), 20)),
    );
    const [a, b] = await Promise.all([
      getCachedCatalog('org1', 'm1', loader),
      getCachedCatalog('org1', 'm1', loader),
    ]);
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves cached catalog within TTL', async () => {
    clearLineageServerCache('org2');
    const loader = vi.fn().mockResolvedValue(cat);
    await getCachedCatalog('org2', 'm1', loader);
    await getCachedCatalog('org2', 'm1', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(LINEAGE_CATALOG_TTL_MS).toBeGreaterThan(0);
  });

  it('caches consumers per org', async () => {
    clearLineageServerCache('org3');
    const loader = vi.fn().mockResolvedValue([]);
    await getCachedConsumers('org3', loader);
    await getCachedConsumers('org3', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
