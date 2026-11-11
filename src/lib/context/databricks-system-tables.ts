/**
 * Unity Catalog system tables used by context harvest (T3) and diagnostics.
 * Prefer these identifiers over legacy `system.<schema>.<table>` names.
 */
export const QUERY_HISTORY_TABLE = 'system_tables.query.query_history';
