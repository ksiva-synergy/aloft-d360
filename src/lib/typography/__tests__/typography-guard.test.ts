import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Typography guard (plan: docs/audits/typography-implementation-plan.md).
 *  1. Every font family named in source is actually loaded (a named-but-never-imported font
 *     silently falls back to the browser default — that is how headings rendered in Times New Roman).
 *  2. No runtime font CDN.
 *  3. Hardcoded typography may only shrink: counts are compared to typography-baseline.json.
 *     After migrating an area, run `UPDATE_TYPOGRAPHY_BASELINE=1 npx vitest run src/lib/typography` to lower it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const SRC = join(REPO, 'src');
const BASELINE = join(HERE, 'typography-baseline.json');

const LOADED = ['Inter Variable', 'Inter', 'IBM Plex Mono'];
const GENERIC = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'SFMono-Regular', 'ui-serif', 'ui-sans-serif', 'Helvetica'];
/** Server-side PNG rendering loads its own TTFs from assets/fonts (resvg), not the browser bundle. */
const SERVER_RENDER_FILES = ['lib/studio/aloftDarkTheme.ts', 'lib/studio/ssr-render.ts'];
const SERVER_RENDER_FONTS = ['Inter Tight'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'api') continue;
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((p) => ({ rel: relative(SRC, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

describe('typography guard', () => {
  it('only names fonts that are loaded', () => {
    const bad: string[] = [];
    for (const { rel, text } of files) {
      if (rel.startsWith('styles/typography.css')) continue;
      // CSS declarations, and TS/JSX string-literal values (`fontFamily: "'A', serif"` / `fontFamily: 'A, serif'`).
      const values: string[] = [];
      for (const m of text.matchAll(/font-family\s*:\s*([^;}\n]+)/g)) values.push(m[1]);
      for (const m of text.matchAll(/fontFamily\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) values.push(m[2]);
      for (const value of values) {
        if (/var\(|inherit/.test(value)) continue;
        for (const raw of value.split(',')) {
          const name = raw.replace('!important', '').trim().replace(/^['"]|['"]$/g, '');
          if (!name || name.startsWith('${') || LOADED.includes(name) || GENERIC.includes(name)) continue;
          if (SERVER_RENDER_FILES.includes(rel) && SERVER_RENDER_FONTS.includes(name)) continue;
          bad.push(`${rel}: ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not load fonts from a CDN at runtime', () => {
    const bad = files.filter(({ text }) => /fonts\.(googleapis|gstatic)\.com/.test(text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it('does not grow hardcoded typography', () => {
    const count = (re: RegExp) => files.reduce((n, { text }) => n + (text.match(re) ?? []).length, 0);
    const current = {
      inlineFontSize: count(/fontSize\s*:/g),
      arbitraryTextSize: count(/\btext-\[[0-9.]+(px|rem)\]/g),
      inlineFontFamilyLiteral: count(/fontFamily\s*:\s*['"`]/g),
      inlineLetterSpacing: count(/letterSpacing\s*:/g),
      heavyWeights: count(/fontWeight\s*:\s*[78]00|\bfont-(bold|extrabold)\b/g),
    };
    if (process.env.UPDATE_TYPOGRAPHY_BASELINE) {
      writeBaseline(current);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof current;
    const grew = (Object.keys(current) as (keyof typeof current)[])
      .filter((k) => current[k] > baseline[k])
      .map((k) => `${k}: ${current[k]} > baseline ${baseline[k]}`);
    expect(grew, 'Use a type token (src/lib/typography/tokens.ts or text-* classes) instead of a new literal').toEqual([]);
  });
});

import { writeFileSync } from 'node:fs';
function writeBaseline(data: Record<string, number>) {
  writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n');
}
