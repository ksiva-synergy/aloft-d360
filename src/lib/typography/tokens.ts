/**
 * Typography tokens for places that cannot use a Tailwind class: inline styles, ECharts, canvas.
 * Values mirror src/styles/typography.css (src/lib/typography/__tests__/typography-tokens.test.ts keeps them in sync).
 * Plan: docs/audits/typography-implementation-plan.md
 */
import type { CSSProperties } from 'react';

/** Literal stacks: canvas and ECharts cannot resolve `var(--font-*)`. Keep in sync with typography.css. */
export const FONT_SANS = "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" as const;
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace" as const;

export const TYPE_TOKEN_NAMES = [
  'display', 'title-page', 'title-section', 'title-card',
  'body-lg', 'body', 'ui-lg', 'ui', 'ui-regular', 'label', 'caption', 'eyebrow',
  'kpi-lg', 'kpi-md', 'kpi-sm', 'code', 'code-inline',
] as const;
export type TypeTokenName = (typeof TYPE_TOKEN_NAMES)[number];

const MONO_TOKENS: ReadonlySet<TypeTokenName> = new Set(['code', 'code-inline']);
const TABULAR_TOKENS: ReadonlySet<TypeTokenName> = new Set(['kpi-lg', 'kpi-md', 'kpi-sm']);

function make(name: TypeTokenName): CSSProperties {
  const style: CSSProperties = {
    fontFamily: MONO_TOKENS.has(name) ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: `var(--type-${name}-size)`,
    fontWeight: `var(--type-${name}-weight)` as unknown as CSSProperties['fontWeight'],
    letterSpacing: `var(--type-${name}-ls)`,
  };
  if (name !== 'code-inline') style.lineHeight = `var(--type-${name}-lh)`;
  if (name === 'eyebrow') style.textTransform = 'uppercase';
  if (TABULAR_TOKENS.has(name)) style.fontVariantNumeric = 'tabular-nums';
  return style;
}

/** Spread into a style object: `style={{ ...type.eyebrow, color }}`. */
export const type: Readonly<Record<TypeTokenName, CSSProperties>> = Object.freeze(
  Object.fromEntries(TYPE_TOKEN_NAMES.map((n) => [n, make(n)])) as Record<TypeTokenName, CSSProperties>,
);

/** Chart text sizes (px). */
export const CHART_TEXT = { axis: 11, legend: 12, tooltip: 13 } as const;
