/**
 * Scheduling for warehouse work: parallel, but never two items at once that read the same
 * warehouse object (one slow view queried 4x in parallel made every query exceed its budget).
 * Pure.
 */
/** Warehouse objects (catalog.schema.table) a SQL statement reads. */
export function warehouseObjectsOf(sql: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (sql ?? '').matchAll(/\b(?:from|join)\s+`?([A-Za-z_][\w]*)`?\.`?([A-Za-z_][\w]*)`?\.`?([A-Za-z_][\w]*)`?/gi)) {
    out.add(`${m[1]}.${m[2]}.${m[3]}`.toLowerCase());
  }
  return [...out];
}

/**
 * Run `work` over `items` with up to `concurrency` in flight, never two at once that share an
 * object (from `objectsOf`). Items keep their order among those that are free to start.
 */
export async function runWithObjectLocks<T>(
  items: T[],
  objectsOf: (item: T) => string[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const pending = items.map((item) => ({ item, objects: objectsOf(item) }));
  const busy = new Set<string>();
  let running = 0;
  let wake: (() => void) | null = null;
  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (pending.length) {
      const idx = pending.findIndex((p) => p.objects.every((o) => !busy.has(o)));
      if (idx === -1) {
        if (running === 0) break; // cannot happen (nothing holds a lock) — avoid a deadlock anyway
        await new Promise<void>((resolve) => {
          const prev = wake;
          wake = () => {
            prev?.();
            resolve();
          };
        });
        continue;
      }
      const [next] = pending.splice(idx, 1);
      next!.objects.forEach((o) => busy.add(o));
      running += 1;
      try {
        await work(next!.item);
      } finally {
        next!.objects.forEach((o) => busy.delete(o));
        running -= 1;
        signal();
      }
    }
  });
  await Promise.all(workers);
  // leftovers only if every remaining item was blocked with nothing running (defensive)
  for (const p of pending.splice(0)) await work(p.item);
}
