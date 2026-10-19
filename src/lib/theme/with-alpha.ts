/**
 * Apply a two-digit hex alpha (the `${color}33` idiom) to a color that may be a hex literal OR a
 * CSS variable / functional color. Appending hex digits to `var(--brand-a)` yields invalid CSS that
 * browsers silently drop, so non-hex colors are blended with `color-mix` instead.
 *
 *   withAlpha('#FDB515', '33')          -> '#FDB51533'
 *   withAlpha('var(--brand-a)', '33')   -> 'color-mix(in srgb, var(--brand-a) 20%, transparent)'
 */
export function withAlpha(color: string, hexAlpha: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color + hexAlpha;
  const pct = Math.round((parseInt(hexAlpha, 16) / 255) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
