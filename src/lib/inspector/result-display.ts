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

/** Note attached to a large execute_tool result, or null when the full list fits. */
export function largeResultDisplayNote(rowCount: number, resultsPanel: boolean): string | null {
  const cap = resultsPanel ? CHAT_TABLE_ROWS_WITH_PANEL : CHAT_TABLE_ROWS_WITHOUT_PANEL;
  if (rowCount <= cap) return null;
  return resultsPanel
    ? `This query returned ${rowCount} rows, and the person sees all ${rowCount} in the Results table and can open **Open full table** under your reply (searchable popup — not retyped by you). ` +
        `Do not retype the full list. Answer the question, give totals or breakdowns, show at most ${cap} rows that matter most as a table, ` +
        `and say they can open the full table under your message or in the Results panel.`
    : `This query returned ${rowCount} rows, too many to type into one reply. ` +
        `Answer the question, give totals or breakdowns, show at most ${cap} rows in a table, ` +
        `and add one line saying "Showing ${cap} of ${rowCount}." so the person knows the list is partial.`;
}
