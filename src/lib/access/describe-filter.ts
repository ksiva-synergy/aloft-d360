/**
 * Keep protected values out of describe_schema (E10-T2). Names and types stay (names are visible to
 * everyone, A1); profile values of protected columns the person cannot see are removed: top values,
 * min / max, patterns, samples. Applied only when COLUMN_ACCESS_MODE=enforce.
 */
import { columnAccessMode } from './column-guard';
import { decideColumnUse, type AccessModel, type Person } from './engine';
import { getAccessModel } from './model-store';
import type { AccessPrincipal } from './types';

const VALUE_FIELDS = ['top_k', 'topK', 'min', 'max', 'patterns', 'samples', 'sample_values', 'examples', 'distinct_values', 'mean', 'median', 'p50', 'p95'];

function tableOf(o: Record<string, unknown>, fallback: string | null): string | null {
  for (const k of ['full_path', 'path', 'table', 'table_path']) {
    const v = o[k];
    if (typeof v === 'string' && v.split('.').length === 3) return v.toLowerCase();
  }
  return fallback;
}

/** Walk the result; for every { columns: [...] } under a known table, strip protected values. */
export function stripProtectedValues(value: unknown, model: AccessModel, person: Person, table: string | null = null): number {
  let stripped = 0;
  if (Array.isArray(value)) {
    for (const v of value) stripped += stripProtectedValues(v, model, person, table);
    return stripped;
  }
  if (!value || typeof value !== 'object') return 0;
  const o = value as Record<string, unknown>;
  const here = tableOf(o, table);
  if (Array.isArray(o.columns) && here) {
    for (const c of o.columns as Record<string, unknown>[]) {
      if (!c || typeof c !== 'object' || typeof c.name !== 'string') continue;
      const d = decideColumnUse(model, person, here, c.name, 'output');
      if (d.outcome === 'full') continue;
      for (const f of VALUE_FIELDS) {
        if (f in c) {
          delete c[f];
          stripped++;
        }
      }
      c.protected = `${d.missing.map((p) => p.name).join(', ') || 'Protected'}: values hidden (no access)`;
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'columns') continue;
    if (v && typeof v === 'object') stripped += stripProtectedValues(v, model, person, here);
  }
  return stripped;
}

/** Filter a describe_schema JSON response for this principal (enforce mode only). */
export async function filterDescribeResult(json: string, principal: AccessPrincipal | null | undefined, path?: string | null): Promise<string> {
  if (columnAccessMode() !== 'enforce' || !principal || principal.kind !== 'user') return json;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json;
  }
  const { model } = await getAccessModel(principal.orgId);
  if (!model.targets.length) return json;
  const n = stripProtectedValues(parsed, model, { userId: principal.userId, roles: principal.roles ?? [] }, path && path.split('.').length === 3 ? path.toLowerCase() : null);
  return n ? JSON.stringify(parsed) : json;
}
