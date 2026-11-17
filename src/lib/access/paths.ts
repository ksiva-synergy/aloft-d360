import { ApiError } from '@/lib/http';

/** Lowercase letters, digits, underscores and hyphens (Databricks allows hyphens in backticked names). */
const SEGMENT = /^[a-z0-9_-]+$/;

/** Normalize and validate a catalog / schema / table path (lowercase, 1–3 segments). */
export function normalizeCatalogPath(raw: string): { path: string; pathDepth: number } {
  const path = raw.trim().toLowerCase();
  const parts = path.split('.').filter(Boolean);
  if (parts.length < 1 || parts.length > 3) {
    throw new ApiError(400, 'Path must be catalog, catalog.schema, or catalog.schema.table');
  }
  for (const p of parts) {
    if (!SEGMENT.test(p)) {
      throw new ApiError(400, 'Path segments may only contain lowercase letters, digits, underscores and hyphens');
    }
  }
  return { path: parts.join('.'), pathDepth: parts.length };
}

export function normalizeDepartmentKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) {
    throw new ApiError(400, 'Department key must start with a letter and use lowercase letters, digits, or underscores');
  }
  return key;
}
