/**
 * label.ts — Display-label utilities for memory shelves.
 *
 * SHORT_LABEL_KEEP: domain tokens that should never be filtered by length.
 * deriveBlurb(): generates a human-readable blurb guaranteed non-empty.
 */

export const SHORT_LABEL_KEEP = new Set([
  'imo', 'psc', 'vir', 'sire', 'cdi', 'opex', 'doc', 'tsi', 'msi',
]);

const RULE_TYPE_LABELS: Record<string, string> = {
  HARD_RULE:    'Hard Rule',
  HEURISTIC:    'Heuristic',
  SOURCE_PREF:  'Source Pref',
  FAILURE_MODE: 'Failure Mode',
  SCHEMA_MAP:   'Schema Map',
};

function humanize(ruleType: string): string {
  return RULE_TYPE_LABELS[ruleType] ?? ruleType.replace(/_/g, ' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * Derive a display blurb for a memory bullet.
 * Falls back to "ruleType · truncated ruleText" when shortLabel is just
 * the agentClass (no keywords) or empty.
 */
export function deriveBlurb({
  ruleType,
  ruleText,
  shortLabel,
}: {
  ruleType: string;
  ruleText: string;
  shortLabel?: string | null;
}): string {
  if (shortLabel && shortLabel.includes(' · ')) {
    return shortLabel;
  }
  return `${humanize(ruleType)} · ${truncate(ruleText, 80)}`;
}
