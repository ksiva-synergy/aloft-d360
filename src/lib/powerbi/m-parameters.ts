/**
 * Power Query parameters and incremental-refresh windows, resolved so lineage can compile the
 * filters that use them.
 *
 *   - Parameters: shared expressions `Name = <literal> meta [IsParameterQuery=true, …]` (the
 *     definition holds the value the service uses).
 *   - Incremental refresh: in the service, RangeStart / RangeEnd are replaced per partition by the
 *     refresh policy, so the dataset holds only the policy's rolling window. The desktop parameter
 *     values in the definition are NOT what the service uses; the window is computed from the
 *     policy and the dataset's last refresh instead.
 * Pure — no DB access.
 */

import type { TmdlRefreshPolicy } from '@/lib/powerbi/tmdl-parse';

const LITERAL_RE =
  /^(?:"(?:[^"]|"")*"|-?\d+(?:\.\d+)?|true|false|null|#date\s*\([^)]*\)|#datetime\s*\([^)]*\)|#datetimezone\s*\([^)]*\)|#time\s*\([^)]*\)|#duration\s*\([^)]*\))$/i;

/** Parameter name → its M literal value, for literal-valued parameter queries. */
export function readMParameters(expressions: { name: string; m: string }[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of expressions ?? []) {
    const m = e.m.trim().match(/^([\s\S]+?)\s+meta\s*\[([\s\S]*)\]\s*$/);
    if (!m || !/IsParameterQuery\s*=\s*true/i.test(m[2]!)) continue;
    const value = m[1]!.trim();
    if (LITERAL_RE.test(value)) out[e.name] = value;
  }
  return out;
}

type Gran = 'day' | 'month' | 'quarter' | 'year';

function gran(g: string | null | undefined): Gran | null {
  const k = (g ?? '').toLowerCase();
  return k === 'day' || k === 'month' || k === 'quarter' || k === 'year' ? k : null;
}

function startOf(d: Date, g: Gran): Date {
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  if (g === 'year') return new Date(Date.UTC(y, 0, 1));
  if (g === 'quarter') return new Date(Date.UTC(y, mo - (mo % 3), 1));
  if (g === 'month') return new Date(Date.UTC(y, mo, 1));
  return new Date(Date.UTC(y, mo, d.getUTCDate()));
}

function add(d: Date, g: Gran, n: number): Date {
  const r = new Date(d.getTime());
  if (g === 'year') r.setUTCFullYear(r.getUTCFullYear() + n);
  else if (g === 'quarter') r.setUTCMonth(r.getUTCMonth() + 3 * n);
  else if (g === 'month') r.setUTCMonth(r.getUTCMonth() + n);
  else r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Rows the dataset holds under an incremental-refresh policy, as of `refreshedAt`:
 * [start of the archive (rolling) window, end of the current incremental period).
 * The archive keeps `rollingWindowPeriods` complete periods before the current one plus the
 * current period; the incremental range ends with the current period (shifted by the offset).
 */
export function incrementalRefreshWindow(policy: TmdlRefreshPolicy | null | undefined, refreshedAt: Date): { start: Date; end: Date } | null {
  const rg = gran(policy?.rollingWindowGranularity);
  const ig = gran(policy?.incrementalGranularity) ?? rg;
  if (!policy || !rg || !ig || policy.rollingWindowPeriods == null) return null;
  const offset = policy.incrementalPeriodsOffset ?? 0;
  const end = add(startOf(refreshedAt, ig), ig, 1 + offset);
  const incStart = add(end, ig, -(policy.incrementalPeriods ?? 1));
  const archiveStart = add(startOf(refreshedAt, rg), rg, -policy.rollingWindowPeriods);
  return { start: archiveStart < incStart ? archiveStart : incStart, end };
}

const mDateTime = (d: Date) =>
  `#datetime(${d.getUTCFullYear()}, ${d.getUTCMonth() + 1}, ${d.getUTCDate()}, ${d.getUTCHours()}, ${d.getUTCMinutes()}, ${d.getUTCSeconds()})`;

/** Parameter values for one table: model parameters, with RangeStart / RangeEnd from its policy. */
export function tableParameterValues(
  modelParameters: Record<string, string>,
  policy: TmdlRefreshPolicy | null | undefined,
  refreshedAt: Date,
): Record<string, string> {
  const window = incrementalRefreshWindow(policy, refreshedAt);
  if (!window) return modelParameters;
  return { ...modelParameters, RangeStart: mDateTime(window.start), RangeEnd: mDateTime(window.end) };
}

/**
 * Replace references to parameters (bare `Name` or `#"Name"`) with their literal values. Skips
 * string literals, comments, record fields (`[Name]`), member access (`x.Name`), function calls
 * and any name the query defines as its own step.
 */
export function inlineMParameters(m: string | null, values: Record<string, string>): string | null {
  if (!m || !Object.keys(values).length) return m;
  const steps = new Set(
    [...m.matchAll(/(?:^|[,\s])(#"(?:[^"]|"")*"|[A-Za-z_][\w]*)\s*=(?!=|>)/g)].map((x) =>
      x[1]!.startsWith('#"') ? x[1]!.slice(2, -1).replace(/""/g, '"') : x[1]!,
    ),
  );
  const usable = Object.entries(values).filter(([k]) => !steps.has(k));
  if (!usable.length) return m;
  const val = new Map(usable);
  let out = '';
  let i = 0;
  const prevNonSpace = () => out.trimEnd().slice(-1);
  while (i < m.length) {
    const ch = m[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < m.length && !(m[j] === '"' && m[j + 1] !== '"')) j += m[j] === '"' ? 2 : 1;
      out += m.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && m[i + 1] === '/') {
      const j = m.indexOf('\n', i);
      out += j === -1 ? m.slice(i) : m.slice(i, j);
      i = j === -1 ? m.length : j;
    } else if (ch === '/' && m[i + 1] === '*') {
      const j = m.indexOf('*/', i + 2);
      out += j === -1 ? m.slice(i) : m.slice(i, j + 2);
      i = j === -1 ? m.length : j + 2;
    } else if (ch === '#' && m[i + 1] === '"') {
      let j = i + 2;
      while (j < m.length && !(m[j] === '"' && m[j + 1] !== '"')) j += m[j] === '"' ? 2 : 1;
      const name = m.slice(i + 2, j).replace(/""/g, '"');
      out += val.has(name) ? val.get(name)! : m.slice(i, j + 1);
      i = j + 1;
    } else if (/[A-Za-z_]/.test(ch) && !/[\w.#]/.test(m[i - 1] ?? '')) {
      let j = i;
      while (j < m.length && /[\w.]/.test(m[j]!)) j++;
      const name = m.slice(i, j);
      const next = m.slice(j).match(/^\s*(.)/)?.[1];
      const isField = prevNonSpace() === '[' && next === ']';
      out += val.has(name) && !isField && next !== '(' ? val.get(name)! : name;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
