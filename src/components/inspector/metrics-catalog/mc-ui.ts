/**
 * Shared presentational helpers for the Metrics catalog. Fonts + token accessors
 * only — no state, no JSX. Colors reference the `--mc-*` CSS vars (globals.css)
 * so light/dark track automatically.
 */
import type { CSSProperties } from 'react';
import type { DefKind, GovStatus } from './catalog-types';

export const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
export const SANS: CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
export const SERIF: CSSProperties = { fontFamily: "'Source Serif 4', Georgia, serif" };

export const kindColorVar = (kind: DefKind): string =>
  kind === 'entity'
    ? 'var(--mc-kind-entity)'
    : kind === 'measure'
      ? 'var(--mc-kind-measure)'
      : 'var(--mc-kind-dimension)';

export const kindLabel = (kind: DefKind): string =>
  kind === 'entity' ? 'Entity' : kind === 'measure' ? 'Measure' : 'Dimension';

export const statusColorVar = (status: GovStatus): string =>
  status === 'governed'
    ? 'var(--mc-status-governed)'
    : status === 'candidate'
      ? 'var(--mc-status-candidate)'
      : status === 'archived'
        ? 'var(--mc-status-archived)'
        : 'var(--mc-status-draft)';

export const statusLabel = (status: GovStatus): string =>
  status.charAt(0).toUpperCase() + status.slice(1);

/** Muted/dim ink used across the surface. */
export const MUTED = 'var(--wb-muted, #8892A4)';
export const INK = 'var(--wb-ink, #e6ecf4)';
export const INK_DIM = 'var(--wb-ink-dim, #aeb9c7)';
export const BORDER = 'var(--wb-border-subtle, rgba(253,181,21,0.12))';
export const GOLD = '#FDB515';

/** color-mix tint of a token for chip backgrounds (works light + dark). */
export const tint = (colorVar: string, pct = 14): string => `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;
