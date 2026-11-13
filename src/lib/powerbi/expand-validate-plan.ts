/** Pure repair planning for the expand compile → warehouse test loop (see expand-validate.ts). */

import type { DaxCompileOptions } from '@/lib/powerbi/dax-sql-compile';

function normCol(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Derive the next compile options from a warehouse error, or null when no grounded fix exists. */
export function planRepair(
  error: string,
  sourceAliases: Record<string, string>,
  current: DaxCompileOptions,
): { options: DaxCompileOptions; repair: string } | null {
  const unresolved = error.match(
    /UNRESOLVED_COLUMN[\s\S]*?name\s+`([^`]+)`(?:\.`([^`]+)`)?[\s\S]*?Did you mean one of the following\?\s*\[([^\]]*)\]/,
  );
  if (unresolved) {
    const alias = unresolved[2] ? unresolved[1]! : null;
    const missing = unresolved[2] ?? unresolved[1]!;
    const table = alias ? sourceAliases[alias] : undefined;
    if (!table) return null; // not a warehouse source column (would be a compiler bug)
    const suggestions = unresolved[3]!
      .split(',')
      .map((s) => s.trim().match(/`([^`]+)`\s*$/)?.[1])
      .filter((s): s is string => Boolean(s));
    const hit = suggestions.find((s) => normCol(s) === normCol(missing));
    if (!hit) return null;
    const overrides = { ...(current.columnOverrides ?? {}) };
    overrides[table] = { ...(overrides[table] ?? {}), [missing.toLowerCase()]: hit };
    return {
      options: { ...current, columnOverrides: overrides },
      repair: `column ${table}.${missing} → ${hit} (warehouse suggestion)`,
    };
  }
  if (
    /DATATYPE_MISMATCH|CAST_INVALID_INPUT|INVALID_CAST|cannot be cast/i.test(error) &&
    current.mixedTypeCompare !== 'number'
  ) {
    return {
      options: { ...current, mixedTypeCompare: 'number' },
      repair: 'compare text-vs-number operands numerically',
    };
  }
  return null;
}
