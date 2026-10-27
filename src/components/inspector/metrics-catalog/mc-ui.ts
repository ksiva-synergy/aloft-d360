/**
 * Shared presentational helpers for the Metrics catalog. Fonts + token accessors
 * only — no state, no JSX. Colors reference the `--mc-*` CSS vars (globals.css)
 * so light/dark track automatically.
 */
import type { CSSProperties } from 'react';
import type { DefKind, GovStatus } from './catalog-types';

export const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' };
export const SANS: CSSProperties = { fontFamily: 'var(--font-sans)' };
export const SERIF: CSSProperties = { fontFamily: 'var(--font-sans)' };

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
export const MUTED = 'var(--wb-muted, var(--ink-3))';
export const INK = 'var(--wb-ink, #e6ecf4)';
export const INK_DIM = 'var(--wb-ink-dim, #aeb9c7)';
export const BORDER = 'var(--wb-border-subtle, color-mix(in srgb, var(--brand-a) 12%, transparent))';
export const GOLD = 'var(--brand-a)';

/** color-mix tint of a token for chip backgrounds (works light + dark). */
export const tint = (colorVar: string, pct = 14): string => `color-mix(in srgb, ${colorVar} ${pct}%, transparent)`;
