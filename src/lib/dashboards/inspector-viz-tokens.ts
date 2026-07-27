/**
 * src/lib/dashboards/inspector-viz-tokens.ts
 *
 * Design tokens for the redesigned GUIDED dashboard-builder surfaces (Step 2
 * Blueprint gallery + Step 3 Refine canvas). The single source of truth for the
 * viz palette so the SAME metric renders the SAME colour in a blueprint
 * thumbnail, the refine canvas, and the ECharts viewer.
 *
 * No runtime dependencies (no React, no ECharts, no Prisma) — import freely in
 * client components, in the ECharts theme module (inspectorEchartsTheme.ts), and
 * in the pure sample-data generator (sample-data.ts). This mirrors the pattern
 * of src/lib/bandits/born-tokens.ts.
 *
 * ── Colour discipline (from the redesign spec) ───────────────────────────────
 *  - Categorical = Okabe-Ito (colour-blind-safe). Cap UI use at 6 distinct hues;
 *    anything past that collapses into a neutral "Other".
 *  - Same metric = same colour everywhere → colorForMeasure() is a deterministic
 *    id/label → hue map, consumed by both the SVG-free ECharts option builder and
 *    the registered ECharts theme's default `color` array.
 *  - Primary action accent = amber #FDB515.
 *  - Sequential (single measure over a scale) = Viridis.
 *  - Two-series comparisons = blue/orange (the two most distinct Okabe-Ito hues).
 *  - Never theme a chart inline — the palette rides on the registered ECharts
 *    themes (inspector-dark / inspector-light). These literals exist so the theme
 *    module and the sample generator agree on the exact hues.
 */

// ── Categorical palette — Okabe-Ito (the canonical 8) ────────────────────────
// Ordered so the first 6 are the UI-visible categorical set; #000000 (black) is
// last because it is unusable on the near-black canvas and is never auto-assigned
// on dark. Grouping past the cap uses OKABE_ITO_OTHER, not black.
export const OKABE_ITO: readonly string[] = [
  '#E69F00', // 0 orange
  '#56B4E9', // 1 sky blue
  '#009E73', // 2 bluish green
  '#F0E442', // 3 yellow
  '#0072B2', // 4 blue
  '#D55E00', // 5 vermillion
  '#CC79A7', // 6 reddish purple
  '#000000', // 7 black (reference completeness; not auto-assigned on dark)
] as const;

/** Cap on distinct categorical hues shown in the UI before collapsing to "Other". */
export const MAX_CATEGORICAL = 6 as const;

/** The UI-visible categorical set (respects the cap). */
export const CATEGORICAL: readonly string[] = OKABE_ITO.slice(0, MAX_CATEGORICAL);

/** Neutral hue for the grouped "Other" bucket (never black on the dark canvas). */
export const OKABE_ITO_OTHER = '#768390' as const;

/** Two-series comparison palette — the two most-separable Okabe-Ito hues. */
export const TWO_SERIES: readonly [string, string] = ['#0072B2', '#E69F00'] as const; // blue, orange

/**
 * Sequential (single measure over an ordered scale) — Viridis, 6 stops.
 * Perceptually uniform and colour-blind-safe, matching the categorical choice.
 */
export const VIRIDIS: readonly string[] = [
  '#440154',
  '#414487',
  '#2a788e',
  '#22a884',
  '#7ad151',
  '#fde725',
] as const;

// ── Brand / action accents (theme-stable → literal) ──────────────────────────
export const ACCENT_AMBER = '#FDB515' as const; // primary action
export const NAVY = '#003262' as const;

// ── Semantic status hues (theme-stable literals) ─────────────────────────────
export const GOVERNED = '#009E73' as const; // Okabe-Ito green — governed / live
export const CANDIDATE = '#CC79A7' as const; // Okabe-Ito purple — candidate / draft
export const DANGER = '#D55E00' as const; // Okabe-Ito vermillion — error

// ── Surfaces ─────────────────────────────────────────────────────────────────
// Dark-mode literals from the redesign spec (near-black canvas, glowing cards).
// Component chrome should prefer the `var(--iv-*)` custom properties (defined in
// globals.css) so the surfaces flip in light mode; these literals are the dark
// fallbacks and the source of record for the ECharts themes' opaque backgrounds.
export const SURFACE_DARK = {
  canvas: '#05070b',
  card: '#161b22',
  cardElevated: '#1c222b',
  border: '#262d36',
  borderSubtle: '#1a2029',
} as const;

export const SURFACE_LIGHT = {
  canvas: '#F5F2EB',
  card: '#FFFFFF',
  cardElevated: '#FAFAF7',
  border: '#C8C2AD',
  borderSubtle: '#E4DFCF',
} as const;

/** Theme-reactive surface tokens (resolve from globals.css `--iv-*`). */
export const CANVAS = 'var(--iv-canvas, #05070b)' as const;
export const CARD = 'var(--iv-card, #161b22)' as const;
export const CARD_ELEVATED = 'var(--iv-card-elevated, #1c222b)' as const;
export const BORDER = 'var(--iv-border, #262d36)' as const;
export const BORDER_SUBTLE = 'var(--iv-border-subtle, #1a2029)' as const;
export const INK = 'var(--iv-ink, #e6edf3)' as const;
export const INK_MUTED = 'var(--iv-ink-muted, #8892A4)' as const;
export const INK_DIM = 'var(--iv-ink-dim, #768390)' as const;

// ── Typography roles ─────────────────────────────────────────────────────────
// Inter for ALL UI (labels, titles, pills). Mono is reserved for the SQL trust
// panel ONLY — never labels/titles/pills.
export const UI_FONT = "'Inter Tight', system-ui, sans-serif" as const;
export const MONO_FONT = "'IBM Plex Mono', ui-monospace, monospace" as const;

// ── Deterministic measure → colour ───────────────────────────────────────────
/**
 * Map a measure's stable identity to a fixed categorical hue so the same metric
 * is the same colour in every surface. Prefers the governed definition id (stable
 * across renames); falls back to the label for inline-added items that have no id
 * yet. Uses the capped CATEGORICAL set (never black on dark), matching the
 * born-tokens.ts modelColor() hashing approach.
 */
export function colorForMeasure(idOrLabel: string): string {
  if (!idOrLabel) return CATEGORICAL[0];
  let hash = 0;
  for (let i = 0; i < idOrLabel.length; i++) {
    // djb2-ish; deterministic, order-sensitive so distinct labels spread out.
    hash = (hash * 31 + idOrLabel.charCodeAt(i)) >>> 0;
  }
  return CATEGORICAL[hash % CATEGORICAL.length];
}

/**
 * Resolve an ordered list of series identities to colours. The first
 * MAX_CATEGORICAL get their deterministic hue; any beyond the cap collapse to the
 * neutral "Other" so a chart never shows a wall of indistinguishable colours.
 */
export function colorsForSeries(idsOrLabels: string[]): string[] {
  return idsOrLabels.map((key, i) =>
    i < MAX_CATEGORICAL ? colorForMeasure(key) : OKABE_ITO_OTHER,
  );
}
