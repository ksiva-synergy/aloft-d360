/** Ask Data context mode: harvested catalog context + SQL, or live SQL only. */
export type InspectorContextMode = 'harvested' | 'warehouse_only';

const MODE_CHOOSER_ROLES = new Set(['admin', 'platform_admin']);

/** Admins can switch between Catalog + SQL and SQL only; everyone else always gets Catalog + SQL. */
export function canChooseContextMode(role: string | null | undefined): boolean {
  return !!role && MODE_CHOOSER_ROLES.has(role);
}

/** The mode a turn runs in. Service callers and admins get what they asked for. */
export function effectiveContextMode(
  requested: unknown,
  role: string | null | undefined,
  isService = false,
): InspectorContextMode {
  if (!isService && !canChooseContextMode(role)) return 'harvested';
  return requested === 'warehouse_only' ? 'warehouse_only' : 'harvested';
}
