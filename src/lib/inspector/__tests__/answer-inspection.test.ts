import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { buildInspectorInspection, joinsInSql, sqlFromToolCall, tablesInSql } from '../answer-inspection';

const call = (over: Partial<ToolCall>): ToolCall => ({
  callId: 'c1',
  toolId: 'execute_tool',
  toolName: 'execute_tool',
  status: 'success',
  ...over,
});

describe('sqlFromToolCall', () => {
  it('reads execute_tool args.statement', () => {
    expect(sqlFromToolCall(call({ input: { toolId: 'databricks_sql', args: { statement: 'SELECT 1' } } }))).toBe('SELECT 1');
  });
  it('reads a flat sql field', () => {
    expect(sqlFromToolCall(call({ input: { sql: 'select * from a.b.c' } }))).toBe('select * from a.b.c');
  });
  it('ignores non-SQL inputs', () => {
    expect(sqlFromToolCall(call({ input: { args: { query: 'vessel fuel' } } }))).toBeNull();
  });
});

describe('tablesInSql', () => {
  it('lists FROM and JOIN tables once, without CTEs or subqueries', () => {
    const sql = `WITH recent AS (SELECT * FROM main.ops.voyages WHERE d > '2026')
      SELECT * FROM recent r
      LEFT JOIN \`main\`.\`ops\`.\`vessels\` v ON v.id = r.vessel_id
      JOIN main.ops.voyages x ON x.id = r.id
      WHERE r.id IN (SELECT id FROM main.ops.flags)`;
    expect(tablesInSql(sql)).toEqual(['main.ops.voyages', 'main.ops.vessels', 'main.ops.flags']);
  });
});

describe('joinsInSql', () => {
  it('captures each join clause up to the next clause keyword', () => {
    const sql = 'SELECT * FROM a.b.t1 t\n  LEFT JOIN a.b.t2 u ON u.id = t.id\n  INNER JOIN a.b.t3 AS w ON w.k = u.k AND w.x = 1\nWHERE t.y > 0';
    expect(joinsInSql(sql)).toEqual([
      'LEFT JOIN a.b.t2 u ON u.id = t.id',
      'INNER JOIN a.b.t3 AS w ON w.k = u.k AND w.x = 1',
    ]);
  });
});

describe('buildInspectorInspection', () => {
  it('returns null when no SQL ran and nothing failed', () => {
    expect(buildInspectorInspection(undefined)).toBeNull();
    expect(buildInspectorInspection([call({ input: { args: { query: 'x' } } })])).toBeNull();
  });

  it('collects sources, joins, queries and failures', () => {
    const note = buildInspectorInspection([
      call({ input: { args: { statement: 'SELECT * FROM a.b.t1 JOIN a.b.t2 ON t2.id = t1.id LIMIT 5' } } }),
      call({ callId: 'c2', status: 'error', error: 'TABLE_OR_VIEW_NOT_FOUND', input: { args: { statement: 'SELECT * FROM a.b.missing' } } }),
    ])!;
    expect(note.sources).toBe('a.b.t1\na.b.t2\na.b.missing');
    expect(note.joins).toBe('JOIN a.b.t2 ON t2.id = t1.id');
    expect(note.caveats).toBe('A query failed: TABLE_OR_VIEW_NOT_FOUND');
    expect(note.queries).toHaveLength(2);
  });

  it('says "No joins." when SQL ran without one', () => {
    expect(buildInspectorInspection([call({ input: { args: { statement: 'SELECT 1 FROM a.b.c' } } })])!.joins).toBe('No joins.');
  });
});
