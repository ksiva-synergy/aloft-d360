import { describe, expect, it } from 'vitest';
import { resolveColumns, withMinGroupSize, blankNonCode, type ColumnRef } from '../sql-columns';
import { extractTables } from '../sql-tables';

const C = 'cur.crew.contracts';
const P = 'cur.hr.payroll';
const COLS = new Map<string, string[]>([
  [C, ['name', 'rank', 'fleet', 'salary_amount', 'start_date', 'crew_id']],
  [P, ['crew_id', 'base_salary', 'iban', 'month']],
]);

function ok(sql: string) {
  const r = resolveColumns(sql, COLS);
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r;
}
const uses = (refs: ColumnRef[], column: string) => refs.filter((r) => r.column === column).map((r) => r.use).sort();

describe('resolveColumns: what is supported', () => {
  it('SELECT * expands to every column, in order, as output', () => {
    const r = ok(`SELECT * FROM ${C} WHERE fleet = 'B'`);
    expect(r.outputs.map((o) => o.name)).toEqual(['name', 'rank', 'fleet', 'salary_amount', 'start_date', 'crew_id']);
    expect(uses(r.refs, 'salary_amount')).toEqual(['output']);
    expect(uses(r.refs, 'fleet')).toEqual(['filter', 'output']);
  });

  it('aliases, t.*, qualified and unqualified names', () => {
    const r = ok(`select c.name, p.* from ${C} c join ${P} as p on c.crew_id = p.crew_id`);
    expect(r.outputs.map((o) => o.name)).toEqual(['name', 'crew_id', 'base_salary', 'iban', 'month']);
    expect(uses(r.refs, 'crew_id')).toContain('filter');
    expect(r.refs.find((x) => x.column === 'iban')).toMatchObject({ table: P, use: 'output' });
  });

  it('expressions keep their sources; output aliases are named', () => {
    const r = ok(`SELECT salary_amount * 12 AS annual, UPPER(name) n FROM ${C}`);
    expect(r.outputs).toEqual([
      { name: 'annual', sources: [{ table: C, column: 'salary_amount' }], aggregate: false },
      { name: 'n', sources: [{ table: C, column: 'name' }], aggregate: false },
    ]);
  });

  it('aggregates are "aggregate"; grouping columns are filters', () => {
    const r = ok(`SELECT rank, AVG(salary_amount) AS avg_pay, COUNT(*) FROM ${C} GROUP BY rank`);
    expect(uses(r.refs, 'salary_amount')).toEqual(['aggregate']);
    expect(uses(r.refs, 'rank')).toEqual(['filter', 'output']);
    expect(r.outputs[1]).toMatchObject({ name: 'avg_pay', aggregate: true });
  });

  it('every way of using a column to narrow or rank it counts as filter', () => {
    for (const sql of [
      `SELECT name FROM ${C} WHERE salary_amount > 100000`,
      `SELECT name FROM ${C} ORDER BY salary_amount DESC`,
      `SELECT name, salary_amount FROM ${C} ORDER BY 2`,
      `SELECT rank FROM ${C} GROUP BY rank HAVING MAX(salary_amount) > 5`,
      `SELECT name, RANK() OVER (ORDER BY salary_amount) FROM ${C}`,
      `SELECT CASE WHEN salary_amount > 100000 THEN 'high' END AS band FROM ${C}`,
      `SELECT salary_amount > 100000 AS rich FROM ${C}`,
      `SELECT c.name FROM ${C} c JOIN ${P} p ON p.base_salary = c.salary_amount`,
      `SELECT COUNT(*) FILTER (WHERE salary_amount > 5) FROM ${C}`,
      `SELECT name, salary_amount AS s FROM ${C} ORDER BY s`,
      `SELECT name FROM ${C} QUALIFY ROW_NUMBER() OVER (PARTITION BY rank ORDER BY salary_amount) = 1`,
    ]) {
      expect(uses(ok(sql).refs, 'salary_amount'), sql).toContain('filter');
    }
  });

  it('comments and strings do not hide or invent columns', () => {
    const r = ok(`SELECT name /* salary_amount */ FROM ${C} -- salary_amount\n WHERE rank = 'salary_amount'`);
    expect(uses(r.refs, 'salary_amount')).toEqual([]);
  });

  it('backticks, CAST types, and a trailing semicolon', () => {
    const r = ok(`SELECT CAST(\`salary_amount\` AS STRING) AS s FROM \`cur\`.\`crew\`.\`contracts\`;`);
    expect(uses(r.refs, 'salary_amount')).toEqual(['output']);
  });

  it('struct access on a column (col.field) resolves to the column', () => {
    const cols = new Map([[C, ['address', 'name']]]);
    const r = resolveColumns(`SELECT address.city FROM ${C}`, cols);
    expect(r.ok && r.refs).toEqual([{ table: C, column: 'address', use: 'output' }]);
  });
});

describe('resolveColumns: fail closed', () => {
  it.each([
    ['CTE', `WITH x AS (SELECT * FROM ${C}) SELECT * FROM x`],
    ['sub-query', `SELECT name FROM ${C} WHERE salary_amount > (SELECT AVG(salary_amount) FROM ${C})`],
    ['UNION', `SELECT name FROM ${C} UNION SELECT name FROM ${C}`],
    ['two statements', `SELECT name FROM ${C}; SELECT 1`],
    ['ambiguous column', `SELECT crew_id FROM ${C} c JOIN ${P} p ON c.crew_id = p.crew_id`],
    ['unqualified table', 'SELECT name FROM contracts'],
    ['table function', 'SELECT * FROM read_files(\'s3://x\')'],
    ['LATERAL VIEW', `SELECT name FROM ${C} LATERAL VIEW explode(x) t AS y`],
    ['not a SELECT', `DESCRIBE ${C}`],
    ['* on a table with unknown columns', 'SELECT * FROM cur.other.t'],
  ])('%s', (_name, sql) => {
    expect(resolveColumns(sql, COLS).ok).toBe(false);
  });
});

describe('withMinGroupSize', () => {
  it('adds HAVING before ORDER BY / LIMIT, or extends an existing HAVING safely', () => {
    const q1 = `SELECT rank, AVG(salary_amount) FROM ${C} GROUP BY rank ORDER BY rank LIMIT 10`;
    const r1 = ok(q1);
    expect(withMinGroupSize(q1, r1.clauses)).toBe(`SELECT rank, AVG(salary_amount) FROM ${C} GROUP BY rank HAVING COUNT(*) >= 5 ORDER BY rank LIMIT 10`);
    const q2 = `SELECT rank, AVG(salary_amount) FROM ${C} GROUP BY rank HAVING a = 1 OR b = 2 ORDER BY rank`;
    const r2 = ok(q2);
    expect(withMinGroupSize(q2, r2.clauses)).toContain('HAVING (a = 1 OR b = 2) AND COUNT(*) >= 5');
    const q3 = `SELECT AVG(salary_amount) FROM ${C} WHERE fleet = 'B';`;
    const r3 = ok(q3);
    expect(withMinGroupSize(q3, r3.clauses)).toBe(`SELECT AVG(salary_amount) FROM ${C} WHERE fleet = 'B' HAVING COUNT(*) >= 5`);
  });
});

describe('helpers', () => {
  it('blankNonCode keeps the length and positions', () => {
    const sql = "SELECT 'a--b', x -- c\nFROM t /* y */";
    const b = blankNonCode(sql);
    expect(b.length).toBe(sql.length);
    expect(b.indexOf('FROM')).toBe(sql.indexOf('FROM'));
    expect(b).not.toContain('--');
  });

  it('the table extractor accepts hyphenated catalogs in backticks', () => {
    expect(extractTables('SELECT * FROM `synergymarine-export-prod`.sales.orders')).toEqual({ ok: true, paths: ['synergymarine-export-prod.sales.orders'] });
  });
});

describe('"Totals only" counts only real totals (review C2)', () => {
  it.each(['collect_list', 'collect_set', 'array_agg', 'min', 'max', 'first', 'last', 'any_value', 'median', 'mode', 'percentile'])(
    '%s returns individual values, so the column is output',
    (fn) => {
      const arg = fn === 'percentile' ? 'salary_amount, 0.5' : 'salary_amount';
      const r = ok(`SELECT fleet, ${fn}(${arg}) AS v FROM ${C} GROUP BY fleet`);
      expect(uses(r.refs, 'salary_amount')).toEqual(['output']);
      expect(r.outputs[1]).toMatchObject({ aggregate: false });
    },
  );

  it.each(['sum', 'avg', 'count', 'stddev', 'variance'])('%s is a total', (fn) => {
    const r = ok(`SELECT fleet, ${fn}(salary_amount) AS v FROM ${C} GROUP BY fleet`);
    expect(uses(r.refs, 'salary_amount')).toEqual(['aggregate']);
  });

  it('max_by reveals who has the highest value', () => {
    const r = ok(`SELECT max_by(name, salary_amount) AS top FROM ${C}`);
    expect(uses(r.refs, 'name')).toEqual(['output']);
  });
});
