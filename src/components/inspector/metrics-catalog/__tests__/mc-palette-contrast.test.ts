/**
 * Metrics-catalog palette — WCAG AA contrast guard (mirrors the guided
 * blueprint palette test). The `--mc-kind-*` and `--mc-res-*` tokens render as
 * small chip/label TEXT (body-size) over a ~14% tint of themselves composited on
 * the panel surface. A theme regression here is unreadable text with zero test
 * noise — the class this project treats as non-negotiable. We read the ACTUAL
 * palette from globals.css and assert each clears 4.5:1 in both themes.
 *
 * Deliberately-muted status tokens (draft/archived grey) are NOT asserted at AA
 * body — they are low-emphasis by design; holding them to 4.5 would force a
 * brightening that defeats their purpose.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const GLOBALS_CSS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../app/globals.css');

// Panel surface behind catalog chips (var(--card, #0d1520) fallback / white in light).
const SURFACE = { light: '#FFFFFF', dark: '#0d1520' } as const;
const TINT_ALPHA = 0.16; // chip bg = color-mix(color 16%, transparent) over surface
const AA_BODY = 4.5;

type RGB = { r: number; g: number; b: number };
const parseHex = (hex: string): RGB => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};
const composite = (fg: RGB, a: number, bg: RGB): RGB => ({
  r: a * fg.r + (1 - a) * bg.r,
  g: a * fg.g + (1 - a) * bg.g,
  b: a * fg.b + (1 - a) * bg.b,
});
const relLum = ({ r, g, b }: RGB): number => {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: RGB, b: RGB): number => {
  const la = relLum(a), lb = relLum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
function block(css: string, selector: string): string {
  const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`selector ${selector} not found`);
  return m[1];
}
function cssVar(scope: string, name: string): string {
  const m = scope.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`var ${name} not found`);
  return m[1].trim();
}

const TOKENS = [
  '--mc-kind-entity', '--mc-kind-measure', '--mc-kind-dimension',
  '--mc-res-matched', '--mc-res-notgov', '--mc-res-unrecognized',
] as const;

describe('metrics-catalog palette — WCAG AA contrast', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const scopes = { light: block(css, ':root'), dark: block(css, '.dark') };

  for (const theme of ['light', 'dark'] as const) {
    const scope = scopes[theme];
    const surface = parseHex(SURFACE[theme]);
    for (const token of TOKENS) {
      it(`${token} meets AA body text on chip bg (${theme})`, () => {
        const fg = parseHex(cssVar(scope, token));
        const chipBg = composite(fg, TINT_ALPHA, surface);
        const ratio = contrast(fg, chipBg);
        expect(ratio, `${token} (${theme}) contrast ${ratio.toFixed(2)}:1 < ${AA_BODY}:1`).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});
