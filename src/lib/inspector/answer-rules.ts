/**
 * Answer-content rules shared by Inspector and saved agents. Keeps prose short but the data complete,
 * so a reader can act on the answer without asking what a code means or which record a row is.
 */
export const ANSWER_COMPLETENESS_RULES = `## ANSWER CONTENT
- Short prose, complete data. Keep the narrative brief, but never drop fields a reader needs to act: what or who the record is, when, where, its status, counts, owners and due dates.
- Name things, not just codes. When a row identifies something only by an id, code or abbreviation (a vessel, port, company, person, status or category), look for the table that names it: the source table's other columns first, then related tables (describe_schema action 'relations' or 'search' when available). Join it in the same query and show the name next to the code.
- Decode coded values the same way (status 10 → its meaning). If no lookup exists in the catalog, say so once in a single line, not on every row, and show the raw code.
- Leave out placeholder values that carry no information (sentinel dates, empty strings, all-zero scores); mention once that the field is unusable.
- When you return records, include one row per record with every useful field. The chat shows row lists as tables, so a complete list is easy to read.`;
