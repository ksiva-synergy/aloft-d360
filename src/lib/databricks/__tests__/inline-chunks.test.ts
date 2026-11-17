import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeDatabricksSQL } from '@/lib/databricks/execute';

const columns = [{ name: 'id', type_name: 'INT' }, { name: 'name', type_name: 'STRING' }];
const rowsFrom = (start: number, n: number) => Array.from({ length: n }, (_, i) => [String(start + i), `p${start + i}`]);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** First statement response holds chunk 0 only; the rest come from /result/chunks/{n}. */
function mockChunkedStatement(chunks: number[], opts: { total?: number; omitNext?: boolean } = {}) {
  const calls: string[] = [];
  let offset = 0;
  const bodies = chunks.map((n, i) => {
    const data_array = rowsFrom(offset, n);
    offset += n;
    const next = i + 1 < chunks.length && !opts.omitNext ? { next_chunk_index: i + 1 } : {};
    return { chunk_index: i, row_offset: offset - n, row_count: n, data_array, ...next };
  });
  const total = opts.total ?? offset;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const m = /\/result\/chunks\/(\d+)$/.exec(String(url));
    if (m) return json(bodies[Number(m[1])]);
    return json({
      statement_id: 'stmt-1',
      status: { state: 'SUCCEEDED' },
      manifest: { schema: { columns }, total_row_count: total, total_chunk_count: chunks.length, truncated: false },
      result: bodies[0],
    });
  }));
  return calls;
}

const run = (rowLimit?: number) =>
  executeDatabricksSQL('c1', 'https://adb.example.net', 'wh1', 'tok', { statement: 'SELECT * FROM t', ...(rowLimit ? { rowLimit } : {}) });

afterEach(() => vi.unstubAllGlobals());

describe('executeDatabricksSQL INLINE chunk paging', () => {
  it('follows next_chunk_index so a split result returns every row (64 + 161 = 225)', async () => {
    const calls = mockChunkedStatement([64, 161]);
    const res = await run();
    expect(res.rows).toHaveLength(225);
    expect(res.row_count).toBe(225);
    expect(res.truncated).toBe(false);
    expect(res.rows[224]).toEqual({ id: '224', name: 'p224' });
    expect(calls.some((u) => u.endsWith('/api/2.0/sql/statements/stmt-1/result/chunks/1'))).toBe(true);
  });

  it('returns the same rows when Databricks sends one chunk', async () => {
    mockChunkedStatement([225]);
    const res = await run();
    expect(res.rows).toHaveLength(225);
    expect(res.truncated).toBe(false);
  });

  it('falls back to total_chunk_count when next_chunk_index is missing', async () => {
    mockChunkedStatement([64, 100, 61], { omitNext: true });
    const res = await run();
    expect(res.rows).toHaveLength(225);
  });

  it('stops at the row limit and flags the result as truncated', async () => {
    mockChunkedStatement([64, 161]);
    const res = await run(100);
    expect(res.rows).toHaveLength(100);
    expect(res.truncated).toBe(true);
    expect(res.truncated_at).toBe(100);
  });

  it('flags a partial result when fewer rows arrive than the manifest total', async () => {
    mockChunkedStatement([64], { total: 225 });
    const res = await run();
    expect(res.rows).toHaveLength(64);
    expect(res.truncated).toBe(true);
  });
});
