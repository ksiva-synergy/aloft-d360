/**
 * FOER page theme — a thin alias layer over the app's own design tokens (globals.css).
 *
 * The FOER pages used to carry a private dark-navy / cream palette selected in JS, so they ignored
 * the Sage Studio (light) and Data 360 Night (dark) themes and the user's accent. Every value here is
 * a CSS variable the app already swaps on `.light` / `.dark`, so FOER now follows theme + accent
 * automatically with no JS branching.
 */
export const FOER_THEME = {
  '--foer-bg': 'var(--background)',
  '--foer-surface': 'var(--surface-2)',
  '--foer-surface2': 'var(--surface-3)',
  '--foer-border': 'var(--line-2)',
  '--foer-border-dim': 'var(--line-1)',
  '--foer-text-pri': 'var(--ink-1)',
  '--foer-text-sec': 'var(--ink-2)',
  '--foer-text-mut': 'var(--ink-3)',
  '--foer-gold': 'var(--brand-a-ink)',
  '--foer-wordmark': 'var(--brand-a-ink)',
  '--foer-pill-bg': 'color-mix(in srgb, var(--brand-a) 10%, transparent)',
  '--foer-pill-active': 'color-mix(in srgb, var(--brand-a) 20%, transparent)',
  '--foer-filter-bg': 'color-mix(in srgb, var(--ink-1) 4%, transparent)',
  '--foer-filter-active': 'color-mix(in srgb, var(--brand-a) 14%, transparent)',
  '--foer-card-bg': 'var(--surface-1)',
  '--foer-placeholder-bg': 'var(--surface-2)',
  '--foer-green': 'var(--ok)',
  '--foer-teal': '#0F9488',
  '--foer-amber-bg': 'var(--warn-bg)',
} as const;
