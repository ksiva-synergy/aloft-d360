/**
 * Guided blueprint palette — WCAG contrast guard (the one silent CSS failure mode).
 *
 * The `--bp-*` accent tokens (measure / dimension / undefined) are applied as small
 * accent TEXT in BlueprintStage (`color: GREEN|BLUE|VIOLET`, fontSize ~9.5–10px —
 * body text, not large/badge), sitting over the card background `--bp-card-bg`
 * composited on the app-shell page background. A theme-contrast regression here
 * renders as unreadable labels with NO test noise — exactly the class this project
 * treats as non-negotiable. So we read the ACTUAL palette out of globals.css (not a
 * hardcoded copy) and assert each accent clears the 4.5:1 AA body-text ratio against
 * its effective (alpha-composited) background, in both light and dark themes.
 *
 * Pure: fs read + arithmetic. No jsdom, no rendering.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const GLOBALS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../app/globals.css',
);

// App-shell page background behind the guided builder (stable shell tokens:
// globals.css --bg-base / --estate-bg). The card sits on this; --bp-card-bg is
// semi-transparent, so text's effective background is card-bg composited on it.
const PAGE_BG = { light: '#F5F2EB', dark: '#0a0d12' } as const;

const AA_BODY = 4.5;

type RGB = { r: number; g: number; b: number };

function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Parse `rgba(r,g,b,a)` / `rgb(r,g,b)` → channels + alpha (defaults 1). */
function parseRgba(css: string): { rgb: RGB; a: number } {
  const nums = css.replace(/rgba?\(|\)/g, '').split(',').map((s) => parseFloat(s.trim()));
  return { rgb: { r: nums[0], g: nums[1], b: nums[2] }, a: nums[3] ?? 1 };
}

/** Composite a possibly-translucent foreground color over an opaque background. */
function composite(fg: RGB, a: number, bg: RGB): RGB {
  return {
    r: a * fg.r + (1 - a) * bg.r,
    g: a * fg.g + (1 - a) * bg.g,
    b: a * fg.b + (1 - a) * bg.b,
  };
}

function relLuminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Extract the first flat declaration block for a selector (no nested braces). */
function block(css: string, selector: string): string {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`selector ${selector} not found in globals.css`);
  return m[1];
}

function cssVar(scope: string, name: string): string {
  const m = scope.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`var ${name} not found`);
  return m[1].trim();
}

describe('guided blueprint palette — WCAG AA contrast', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const scopes = { light: block(css, ':root'), dark: block(css, '.dark') };

  for (const theme of ['light', 'dark'] as const) {
    const scope = scopes[theme];
    const pageBg = parseHex(PAGE_BG[theme]);
    const card = parseRgba(cssVar(scope, '--bp-card-bg'));
    const effectiveBg = composite(card.rgb, card.a, pageBg);

    for (const token of ['--bp-measure', '--bp-dimension', '--bp-undefined'] as const) {
      it(`${token} on card bg meets AA body text (${theme})`, () => {
        const fg = parseHex(cssVar(scope, token));
        const ratio = contrastRatio(fg, effectiveBg);
        expect(
          ratio,
          `${token} (${theme}) contrast ${ratio.toFixed(2)}:1 < ${AA_BODY}:1`,
        ).toBeGreaterThanOrEqual(AA_BODY);
      });
    }
  }
});
