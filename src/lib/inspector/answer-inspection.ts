import type { ToolCall } from '@/components/agent-lab/workbench/types';
import type { AgentInspection } from '@/lib/agents/inspection';

export type InspectorAnswerInspection = AgentInspection & { queries: string[] };

const SQL_KEYS = ['statement', 'sql', 'query'] as const;
const CLAUSE_END = /\b(where|group\s+by|order\s+by|having|limit|union|qualify|window|(?:left|right|inner|full|cross)?\s*(?:outer\s+)?join)\b/i;

function pickSql(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const key of SQL_KEYS) {
    const v = rec[key];
    if (typeof v === 'string' && /\bselect\b|\bwith\b|\bshow\b|\bdescribe\b/i.test(v)) return v.trim();
  }
  return null;
}

/** SQL text from a tool call input: `{ args: { statement } }` (execute_tool) or a flat `{ statement | sql | query }`. */
export function sqlFromToolCall(tc: ToolCall): string | null {
  const input = tc.input as Record<string, unknown> | undefined;
  return pickSql(input?.args) ?? pickSql(input);
}

function cteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:\bwith\b|,)\s*([A-Za-z_][\w]*)\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  return names;
}

/** Fully qualified tables referenced after FROM / JOIN (CTEs and subqueries excluded). */
export function tablesInSql(sql: string): string[] {
  const ctes = cteNames(sql);
  const out: string[] = [];
  const re = /\b(?:from|join)\s+([`"\w][`"\w.\-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const name = m[1].replace(/[`"]/g, '');
    if (!name || ctes.has(name.toLowerCase())) continue;
    if (/^(select|lateral|unnest)$/i.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Each `… JOIN table [alias] ON condition` clause, whitespace-collapsed. */
export function joinsInSql(sql: string): string[] {
  const flat = sql.replace(/\s+/g, ' ');
  const out: string[] = [];
  const re = /\b((?:left|right|inner|full|cross)\s+(?:outer\s+)?)?join\s+[^\s(]+(?:\s+(?:as\s+)?(?!on\b)\w+)?(?:\s+on\s+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const start = m.index;
    const rest = flat.slice(start + m[0].length);
    const end = rest.search(CLAUSE_END);
    const clause = (m[0] + (end === -1 ? rest : rest.slice(0, end))).trim().replace(/[;)]+$/, '').trim();
    if (!out.includes(clause)) out.push(clause);
  }
  return out;
}

/**
 * Admin Inspect note for an Inspector answer, derived from the SQL the turn actually ran.
 * Returns null when the turn ran no SQL and had no tool errors.
 */
export function buildInspectorInspection(toolCalls: ToolCall[] | undefined): InspectorAnswerInspection | null {
  if (!toolCalls?.length) return null;
  const queries: string[] = [];
  const tables: string[] = [];
  const joins: string[] = [];
  const caveats: string[] = [];

  for (const tc of toolCalls) {
    const sql = sqlFromToolCall(tc);
    if (tc.status === 'error') {
      const what = sql ? 'A query' : `Tool ${tc.toolName || tc.toolId || 'call'}`;
      caveats.push(`${what} failed${tc.error ? `: ${tc.error}` : '.'}`);
    }
    if (!sql) continue;
    if (!queries.includes(sql)) queries.push(sql);
    for (const t of tablesInSql(sql)) if (!tables.includes(t)) tables.push(t);
    for (const j of joinsInSql(sql)) if (!joins.includes(j)) joins.push(j);
  }

  if (!queries.length && !caveats.length) return null;
  return {
    sources: tables.join('\n'),
    joins: joins.length ? joins.join('\n') : queries.length ? 'No joins.' : '',
    caveats: caveats.join('\n'),
    queries,
  };
}
