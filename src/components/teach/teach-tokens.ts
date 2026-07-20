/**
 * Shared style atoms for the Teach surface (Phase 4).
 *
 * NATIVE to aloft-d360's design system: every color references the APP's own
 * light/dark theme tokens (the `:root` / `.dark` CSS vars in globals.css) — the
 * same tokens its sibling, the Teach Digest, is built from. No prototype palette,
 * no scoped `--tm-*` vars, no hardcoded hex. Fonts are the repo's loaded families.
 */
import type { LearningState, LearningType } from '@/lib/inspector/reflect-tools';

export const FONT_DISPLAY = "'Source Serif 4', Georgia, serif";
export const FONT_BODY = "'Inter Tight', Inter, system-ui, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";

/**
 * State → the APP theme token that drives its dot / badge / chip:
 *   proposed/verifying → --primary (app blue; no dedicated info token exists),
 *   verified → --success, conflict → --warning, rejected → --destructive.
 */
export const STATE_VAR: Record<LearningState, string> = {
  proposed: 'var(--primary)',
  verifying: 'var(--primary)',
  verified: 'var(--success)',
  conflict: 'var(--warning)',
  rejected: 'var(--destructive)',
};

export const STATE_LABEL: Record<LearningState, string> = {
  proposed: 'Proposed',
  verifying: 'Verifying',
  verified: 'Verified',
  conflict: 'Conflict',
  rejected: 'Rejected',
};

export const TYPE_LABEL: Record<LearningType, string> = {
  metric_definition: 'Metric definition',
  enterprise_convention: 'Enterprise convention',
  estate_navigation: 'Estate navigation',
  vocabulary_entity: 'Vocabulary · entity',
  other: 'Other',
};

/** `color-mix` tint of an app theme color at the given alpha percentage. */
export const mix = (colorVar: string, pct: number) =>
  `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;

/** Uppercase mono micro-label — the recurring caption style. */
export const microLabel: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

/** A soft tinted status pill in a given state color. */
export function statePill(colorVar: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '2px 8px',
    borderRadius: 20,
    background: mix(colorVar, 14),
    boxShadow: `inset 0 0 0 1px ${mix(colorVar, 32)}`,
    color: colorVar,
    fontFamily: FONT_MONO,
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
  };
}

/** The base surface-card style used by rail cards and panels. */
export const surfaceCard: React.CSSProperties = {
  borderRadius: 13,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
  padding: 14,
};
