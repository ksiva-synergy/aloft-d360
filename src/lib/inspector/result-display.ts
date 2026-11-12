import type { QueryResult } from '@/hooks/useInspectorChat';

/**
 * Ask Data often runs several SQL calls per reply (samples, counts, then the real answer).
 * Under the message we show one browsable dataset; the rest stay available on tabs.
 */
export function rankQueryResultsForChat(
  indices: number[],
  results: QueryResult[],
): { ordered: number[]; primary: number } {
  const valid = indices.filter((i) => (results[i]?.rows.length ?? 0) > 0);
  if (valid.length === 0) return { ordered: indices.slice(0, 1), primary: indices[0] ?? 0 };
  if (valid.length === 1) return { ordered: valid, primary: valid[0] };

  const score = (i: number) => {
    const r = results[i]!;
    const loaded = r.rows.length;
    const sql = r.sql.trim().toLowerCase();
    const tinyLimit = /\blimit\s+([1-9]|1\d|20)\s*;?\s*$/.test(sql);
    const probe = tinyLimit && loaded <= 20;
    const pos = valid.indexOf(i);
    return (probe ? 0 : 10_000) + loaded * 10 + pos;
  };

  const sorted = [...valid].sort((a, b) => score(b) - score(a));
  return { ordered: sorted, primary: sorted[0] };
}

/** Data rows in GitHub-flavored markdown tables inside the assistant reply (not warehouse SQL). */
function markdownTableCells(line: string): string[] {
  return line
    .trim()
    .split('|')
    .map((c) => c.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

/** Indexes of GFM tables in document order and their body row counts. */
export function markdownTablesInContent(content: string): { index: number; rowCount: number }[] {
  const lines = content.split('\n');
  const tables: { index: number; rowCount: number }[] = [];
  let i = 0;
  let tableIndex = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRowLine(line) && i + 1 < lines.length && isSeparatorLine(lines[i + 1])) {
      let rows = 0;
      i += 2;
      while (i < lines.length && isTableRowLine(lines[i])) {
        rows += 1;
        i += 1;
      }
      tables.push({ index: tableIndex++, rowCount: rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

/** The main data table in the reply — usually the largest markdown table. */
export function primaryMarkdownTableIndex(content: string): number {
  const tables = markdownTablesInContent(content);
  if (!tables.length) return -1;
  let best = tables[0];
  for (const t of tables) {
    if (t.rowCount >= best.rowCount) best = t;
  }
  return best.index;
}

function isTableRowLine(line: string): boolean {
  const t = line.trim();
  return /^\|.+\|/.test(t) && markdownTableCells(t).length >= 1 && !isSeparatorLine(t);
}

function isSeparatorLine(line: string): boolean {
  const t = line.trim();
  return /^\|[\s\-:|]+\|/.test(t) && markdownTableCells(t).every((c) => /^[\s\-:]+$/.test(c));
}

export function countMarkdownTableDataRows(content: string): number {
  const lines = content.split('\n');
  let inTable = false;
  let pastSeparator = false;
  let count = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!inTable) {
      if (/^\|.+\|/.test(t) && markdownTableCells(t).length >= 1) inTable = true;
      continue;
    }
    if (/^\|[\s\-:|]+\|/.test(t) && markdownTableCells(t).every((c) => /^[\s\-:]+$/.test(c))) {
      pastSeparator = true;
      continue;
    }
    if (!/^\|.+\|/.test(t)) {
      inTable = false;
      pastSeparator = false;
      continue;
    }
    if (pastSeparator) count += 1;
  }
  return count;
}

/**
 * Popup full dataset when the answer already shows a markdown table but the warehouse
 * returned more rows than fit in that typed table (members never get raw SQL grids).
 */
export function shouldOfferChatFullTable(messageContent: string, result: QueryResult): boolean {
  const mdRows = countMarkdownTableDataRows(messageContent);
  if (mdRows < 1) return false;
  const total = result.rowCount;
  const loaded = result.rows.length;
  if (result.truncated || total > loaded) return true;
  if (total > mdRows) return true;
  if (loaded > mdRows + 2) return true;
  return false;
}

/** Short tab label — row count and shape, not warehouse table names. */
export function queryResultTabLabel(result: QueryResult, tabIndex: number, tabCount: number): string {
  const rows = result.rows.length;
  const cols = result.columns.length;
  if (tabCount === 1) return `${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`;
  const shape =
    cols <= 3 && rows <= 15 ? 'Summary' : rows <= 5 ? 'Sample' : tabIndex === 0 ? 'Main' : `Data ${tabIndex + 1}`;
  return `${shape} · ${rows.toLocaleString()}r`;
}

/**
 * How many query rows the model should retype into its chat reply.
 *
 * The rows always stay in the tool result so the model can analyse them; this
 * only limits how many it copies into a markdown table. A typed row costs about
 * 20–40 output tokens, so a few hundred rows overrun the 4096-token reply cap and
 * the table stops partway through (e.g. 64 of 225 one run, more the next).
 */

/** Rows to type when the surface shows every row in its own Results table (Inspector). */
export const CHAT_TABLE_ROWS_WITH_PANEL = 10;
/** Rows to type when the chat is the only place the person sees the data (saved agents). */
export const CHAT_TABLE_ROWS_WITHOUT_PANEL = 40;

/** Max warehouse rows kept for in-chat / Results tables (SSE `query_result` payload). */
export const CHAT_QUERY_RESULT_MAX_ROWS = 5000;

/** Note attached to a large execute_tool result, or null when the full list fits. */
export function largeResultDisplayNote(rowCount: number, resultsPanel: boolean): string | null {
  const cap = resultsPanel ? CHAT_TABLE_ROWS_WITH_PANEL : CHAT_TABLE_ROWS_WITHOUT_PANEL;
  if (rowCount <= cap) return null;
  return resultsPanel
    ? `This query returned ${rowCount} rows, and the person sees the full loaded dataset in the searchable table under your reply (and in the Results panel) — not retyped by you. ` +
        `Do not retype the full list. Answer the question, give totals or breakdowns, show at most ${cap} rows that matter most as a markdown table if helpful, ` +
        `and say the complete data is in the table under your message or in the Results panel.`
    : `This query returned ${rowCount} rows, too many to type into one reply. ` +
        `Answer the question, give totals or breakdowns, show at most ${cap} rows in a markdown table in your reply, ` +
        `and add one line saying "Showing ${cap} of ${rowCount}." The person gets an **Open full table** button under your message when the typed table is shorter than the warehouse result.`;
}
