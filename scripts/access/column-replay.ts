/**
 * column-replay.ts (E11-T1): READ-ONLY replay of past AI-written SQL through the column check.
 *
 * For every execute_tool call in the last N days it asks: does the query touch a table with
 * protected columns? Could the parser read it? What would be masked or refused for someone who holds
 * NO protections (the worst case)? How long did the check take? Nothing is written.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/column-replay.ts [days=30]
 */
import { prisma } from '@/lib/db';
import { loadAccessModel } from '@/lib/access/model-store';
import { decideColumnUse, pathProtections } from '@/lib/access/engine';
import { extractTablesForAuthorization } from '@/lib/access/sql-tables';
import { resolveColumns } from '@/lib/access/sql-columns';

const DAYS = Number(process.argv[2] ?? 30) || 30;

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function main() {
  const id = process.env.DEFAULT_ORG_ID?.trim();
  const org = id ? { id } : await prisma.platformOrg.findFirst({ where: process.env.DEFAULT_ORG_SLUG ? { slug: process.env.DEFAULT_ORG_SLUG } : {}, select: { id: true } });
  if (!org) throw new Error('No org found');
  const model = await loadAccessModel(org.id);
  const nobody = { userId: '__replay_nobody__', roles: ['member'] };

  const calls = await prisma.tool_invocation_log.findMany({
    where: { tool_name: 'execute_tool', created_at: { gte: new Date(Date.now() - DAYS * 86_400_000) } },
    select: { input: true, duration_ms: true },
  });
  const columnCache = new Map<string, string[]>();
  async function columnsFor(path: string): Promise<string[]> {
    if (columnCache.has(path)) return columnCache.get(path)!;
    const obj = await prisma.platformContextObject.findFirst({ where: { org_id: org!.id, full_path: path }, select: { id: true } });
    const cols = obj
      ? (await prisma.platformContextColumn.findMany({ where: { object_id: obj.id }, select: { name: true }, orderBy: { ordinal: 'asc' } })).map((c) => c.name.toLowerCase())
      : [];
    for (const t of model.targets) if (t.column && t.path === path && !cols.includes(t.column)) cols.push(t.column);
    columnCache.set(path, cols);
    return cols;
  }

  let total = 0, tableUnreadable = 0, touchesProtected = 0, parserUnsure = 0, wouldRefuse = 0, wouldMask = 0;
  let coverageOk = 0, coverageTried = 0;
  const parseMs: number[] = [];
  const tableReasons = new Map<string, number>();
  const coverageReasons = new Map<string, number>();
  const checkMs: number[] = [];
  const queryMs: number[] = [];
  const unsureReasons = new Map<string, number>();
  const refusedCols = new Map<string, number>();
  const maskedCols = new Map<string, number>();

  for (const c of calls) {
    const sql = (c.input as { args?: { statement?: unknown } } | null)?.args?.statement;
    if (typeof sql !== 'string' || !sql.trim()) continue;
    total++;
    queryMs.push(c.duration_ms);
    const tables = extractTablesForAuthorization(sql);
    if (!tables.ok) {
      tableUnreadable++;
      tableReasons.set(tables.reason, (tableReasons.get(tables.reason) ?? 0) + 1);
      continue;
    }
    // Coverage: could the parser read this query if its tables had protected columns?
    if (tables.paths.length) {
      coverageTried++;
      const all = new Map<string, string[]>();
      for (const t of tables.paths) all.set(t, await columnsFor(t));
      const tp = performance.now();
      const cr = resolveColumns(sql, all);
      parseMs.push(performance.now() - tp);
      if (cr.ok) coverageOk++;
      else {
        const k = cr.reason.replace(/[a-z0-9_]+\.[a-z0-9_.]+/g, '<name>').replace(/Column \S+ is/, 'Column <c> is');
        coverageReasons.set(k, (coverageReasons.get(k) ?? 0) + 1);
      }
    }
    const guarded = tables.paths.filter((t) => pathProtections(model, t).length > 0 || model.targets.some((x) => x.column !== null && x.path === t));
    if (!guarded.length) continue;
    touchesProtected++;
    const t0 = performance.now();
    const map = new Map<string, string[]>();
    for (const t of tables.paths) map.set(t, await columnsFor(t));
    const r = resolveColumns(sql, map);
    if (!r.ok) {
      parserUnsure++;
      unsureReasons.set(r.reason, (unsureReasons.get(r.reason) ?? 0) + 1);
      checkMs.push(performance.now() - t0);
      continue;
    }
    let refuse = false;
    let mask = false;
    for (const ref of r.refs) {
      const o = decideColumnUse(model, nobody, ref.table, ref.column, ref.use).outcome;
      const key = `${ref.table}.${ref.column}`;
      if (o === 'refused') {
        refuse = true;
        refusedCols.set(key, (refusedCols.get(key) ?? 0) + 1);
      } else if (o === 'masked') {
        mask = true;
        maskedCols.set(key, (maskedCols.get(key) ?? 0) + 1);
      }
    }
    checkMs.push(performance.now() - t0);
    if (refuse) wouldRefuse++;
    else if (mask) wouldMask++;
  }

  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const lines = [
    `# Column check replay (last ${DAYS} days, read-only)`,
    '',
    `Run ${new Date().toISOString()}. Worst case: a person who holds no protections.`,
    '',
    `- AI queries replayed: ${total}`,
    `- Table check could not read (refused today already): ${tableUnreadable}`,
    `- Touch a table with protected data: ${touchesProtected} (${total ? ((100 * touchesProtected) / total).toFixed(1) : 0}%)`,
    `- Of those, parser not sure (would be refused): ${parserUnsure} (${touchesProtected ? ((100 * parserUnsure) / touchesProtected).toFixed(1) : 0}%)`,
    `- Would be refused (protected column used to filter / sort / group / join): ${wouldRefuse}`,
    `- Would run with masked columns: ${wouldMask}`,
    `- Column check time on protected-table queries: p50 ${pct(checkMs, 50).toFixed(2)} ms, p95 ${pct(checkMs, 95).toFixed(2)} ms (queries themselves: p50 ${pct(queryMs, 50)} ms, p95 ${pct(queryMs, 95)} ms)`,
    '',
    '## Parser coverage (if every table had protected columns)',
    `- Readable: ${coverageOk} of ${coverageTried} (${coverageTried ? ((100 * coverageOk) / coverageTried).toFixed(1) : 0}%) · parse time p50 ${pct(parseMs, 50).toFixed(2)} ms, p95 ${pct(parseMs, 95).toFixed(2)} ms, max ${pct(parseMs, 100).toFixed(2)} ms`,
    ...top(coverageReasons).map(([k, v]) => `- ${v} × ${k}`),
    '',
    '## Why the table check refuses today (applies once ACCESS_MODE=enforce)',
    ...(tableReasons.size ? top(tableReasons).map(([k, v]) => `- ${v} × ${k}`) : ['- (none)']),
    '',
    '## Why the parser was not sure',
    ...(unsureReasons.size ? top(unsureReasons).map(([k, v]) => `- ${v} × ${k}`) : ['- (none)']),
    '',
    '## Most refused columns',
    ...(refusedCols.size ? top(refusedCols).map(([k, v]) => `- ${v} × ${k}`) : ['- (none)']),
    '',
    '## Most masked columns',
    ...(maskedCols.size ? top(maskedCols).map(([k, v]) => `- ${v} × ${k}`) : ['- (none)']),
    '',
  ];
  console.log(lines.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
