import { friendlyDataLabel } from '@/lib/access/denial-ui';

/**
 * Approver-facing purpose: Inspector question + tables the agent already resolved from SQL.
 * The requester does not type table names.
 */
export function buildAgentAccessRequestPurpose(opts: {
  paths: string[];
  userQuestion?: string;
  bundleRef?: string | null;
}): string {
  const labels = [...new Set(opts.paths.map((p) => friendlyDataLabel(p)))];
  const q = opts.userQuestion?.trim();
  const intro = q
    ? `Question in Ask Data: ${q.slice(0, 500)}`
    : 'Complete a question in Ask Data that was blocked on access.';
  const tables =
    labels.length > 1
      ? `Agent-identified tables for this work: ${labels.join('; ')}.`
      : labels.length === 1
        ? `Agent-identified table for this work: ${labels[0]}.`
        : '';
  const bundle =
    opts.bundleRef && opts.paths.length > 1
      ? ` Linked ${opts.paths.length} requests (ref ${opts.bundleRef}).`
      : '';
  return [intro, tables, bundle].filter(Boolean).join('\n\n').replace(/\n\n\s+/g, '\n\n').trim();
}

/** @deprecated use buildAgentAccessRequestPurpose */
export function buildAccessRequestPurpose(
  purpose: string,
  paths: string[],
  opts?: { bundleRef?: string | null },
): string {
  return buildAgentAccessRequestPurpose({ paths, userQuestion: purpose, bundleRef: opts?.bundleRef });
}
