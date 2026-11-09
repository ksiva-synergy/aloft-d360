import type { DenyReason } from './types';

/** Prefilled My data access form (path or protection tag). */
export function requestUrlForAccess(opts: {
  path?: string;
  tagId?: string;
  label?: string;
  context?: string;
  level?: 'query' | 'export';
  /** Catalog.schema.table values from the blocked SQL (Inspector). */
  queryPaths?: string[];
  /** Slim my-access layout (Inspector prefill). */
  quick?: boolean;
}): string {
  const p = new URLSearchParams();
  if (opts.tagId) p.set('tag', opts.tagId);
  if (opts.path) p.set('path', opts.path.toLowerCase());
  if (opts.label) p.set('label', opts.label.slice(0, 120));
  if (opts.context) p.set('context', opts.context.slice(0, 500));
  if (opts.level) p.set('level', opts.level);
  if (opts.queryPaths?.length) {
    p.set(
      'qp',
      opts.queryPaths
        .map((x) => x.toLowerCase().trim())
        .filter((x) => x.split('.').length === 3)
        .slice(0, 8)
        .join(','),
    );
    if (opts.quick !== false) p.set('quick', '1');
  }
  const q = p.toString();
  return q ? `/my-access?${q}` : '/my-access';
}

export type ParsedAccessRequestHref = {
  path: string | null;
  tagId: string | null;
  label: string | null;
  context: string | null;
  queryPaths: string[];
  level: 'query' | 'export' | null;
  quick: boolean;
};

/** Parse `/my-access?…` from Inspector Request access links. */
export function parseAccessRequestHref(href: string | null | undefined): ParsedAccessRequestHref | null {
  if (!href?.trim()) return null;
  try {
    const url = new URL(href, 'https://aloft.local');
    const level = url.searchParams.get('level');
    return {
      path: url.searchParams.get('path'),
      tagId: url.searchParams.get('tag'),
      label: url.searchParams.get('label'),
      context: url.searchParams.get('context'),
      queryPaths: parseQueryPathsParam(url.searchParams.get('qp')),
      level: level === 'export' ? 'export' : level === 'query' ? 'query' : null,
      quick: url.searchParams.get('quick') === '1',
    };
  } catch {
    return null;
  }
}

export function parseQueryPathsParam(qp: string | null | undefined): string[] {
  if (!qp?.trim()) return [];
  return [...new Set(qp.split(',').map((p) => p.trim().toLowerCase()).filter((p) => p.split('.').length === 3))];
}

/** What a path grant covers (for approvers). */
export function scopeSummaryForPath(path: string): { depth: number; summary: string } {
  const depth = path.split('.').length;
  if (depth >= 3) return { depth, summary: 'This table only (not parent catalog or schema unless granted there too).' };
  if (depth === 2) return { depth, summary: 'This schema and every table and view inside it.' };
  return { depth, summary: 'This catalog and every schema, table, and view inside it.' };
}

/** Plain-language label for stakeholders (no catalog.schema.table paths). */
export function friendlyDataLabel(path: string | undefined): string {
  if (!path) return 'this data';
  const leaf = path.split('.').pop() ?? path;
  const normalized = leaf
    .replace(/_ranked_by_id$/i, '')
    .replace(/_master$/i, '')
    .replace(/_/g, ' ')
    .trim();
  if (/^employee\b/i.test(normalized) || /\bemployee\b/i.test(normalized)) return 'employee records';
  if (!normalized) return 'this data';
  return `${normalized} data`;
}

/** User-facing denial (shown in chat banner and tool errors). Does not imply the record does not exist. */
export function tableDenialMessage(failedPath: string | undefined, reason: DenyReason, protectionNames: string[]): string {
  const where = friendlyDataLabel(failedPath);
  if (reason === 'explicit_deny') {
    return `Access to ${where} is blocked for your account. Ask a data access administrator if you believe this is wrong.`;
  }
  if (reason === 'needs_clearance' && protectionNames.length) {
    return `You don't have access to ${protectionNames.join(', ')} data on ${where}. If you need it for your work, request access below.`;
  }
  if (reason === 'sql_unresolved') {
    return `This query could not be checked for access. Try a simpler SELECT from one table, or request access to the data you need.`;
  }
  return `You don't have access to ${where}. If you need it for your work, request access below.`;
}

/** Extra instruction returned to the model in ACCESS_DENIED tool JSON (not shown verbatim to the user). */
export const ACCESS_DENIED_MODEL_HINT =
  'The person lacks access; the data may exist but is restricted to them. Do not say the record was not found, that you could not access the system, or that the employee or row does not exist. Say plainly that their account does not have access. Do not put catalog, schema, or table names, SQL paths, or /my-access URLs in the reply — the UI shows a Request access button. Do not suggest unrelated lookups as a workaround.';
