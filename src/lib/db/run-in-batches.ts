type TaskReturn<F> = F extends () => Promise<infer R> ? R : never;

/**
 * Run async tasks with a max concurrency cap. Preserves tuple result types when
 * `tasks` is a `const` array (e.g. `runInBatches([() => a(), () => b()] as const, 4)`).
 */
export async function runInBatches<const T extends readonly (() => Promise<unknown>)[]>(
  tasks: T,
  concurrency: number,
): Promise<{ -readonly [K in keyof T]: TaskReturn<T[K]> }> {
  const limit = Math.max(1, concurrency);
  const results: unknown[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const chunk = tasks.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map((fn) => fn()));
    results.push(...chunkResults);
  }
  return results as { -readonly [K in keyof T]: TaskReturn<T[K]> };
}
