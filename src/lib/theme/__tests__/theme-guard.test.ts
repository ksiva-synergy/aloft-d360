import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Regression guard for the app theme. Each rule matches a pattern that once made a page ignore the
 * Sage Studio / Data 360 Night themes or the user's accent. Use the shared tokens instead:
 *   surfaces --background --surface-1/2/3 · lines --line-1/2 · text --ink-1/2/3
 *   accent --brand-a --brand-a-2 --brand-a-ink --brand-a-soft · status --ok --warn --bad
 * For `${color}33` style alpha use withAlpha() from '@/lib/theme/with-alpha'.
 */
const SRC = join(__dirname, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

interface Hit {
  file: string;
  line: number;
  code: string;
}

function find(rule: RegExp, opts: { skipLine?: RegExp; skipFile?: RegExp } = {}): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    if (opts.skipFile?.test(f.path)) continue;
    f.text.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (opts.skipLine?.test(line)) return;
      if (rule.test(line)) hits.push({ file: f.path, line: i + 1, code: line.trim().slice(0, 120) });
    });
  }
  return hits;
}

const fmt = (h: Hit[]) => h.map((x) => `${x.file}:${x.line}  ${x.code}`).join('\n');
const DARK_AWARE = /\b(dark|isDark|isLight)\b\s*(\?|&&|===|!==)|dark:|useIsDark|resolvedTheme/;

describe('theme guard', () => {
  it('does not treat "not light" as dark (undefined / system must resolve to light)', () => {
    expect(fmt(find(/resolvedTheme\s*!==\s*['"]light['"]/))).toBe('');
  });

  it('uses the accent tokens, not hardcoded indigo / violet / purple utilities', () => {
    // login: brand panel. bandits/types.ts: SOURCE_COLORS is a 7-hue categorical palette (each hue must stay
    // distinct), already written as light + dark pairs.
    const hits = find(/\b(bg|text|border|ring|from|to|via|outline)-(indigo|violet|purple)-\d{2,3}\b/, {
      skipFile: /^(app\/login\/|components\/agent-lab\/bandits\/types\.ts)/,
    });
    expect(fmt(hits)).toBe('');
  });

  it('does not use cool slate neutrals for surfaces, text or borders', () => {
    const hits = find(/\b(bg|text|border|divide|placeholder)-slate-\d{2,3}\b/, { skipFile: /^app\/login\// });
    expect(fmt(hits)).toBe('');
  });

  it('does not tint backgrounds with white-alpha (invisible on light themes)', () => {
    const hits = find(/(background(Color)?|stroke)\s*[:=]\s*['"]rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(0\d|1)\s*\)['"]/, {
      skipLine: DARK_AWARE,
    });
    expect(fmt(hits)).toBe('');
  });

  it('does not append hex alpha to a CSS-variable color constant', () => {
    const hits: Hit[] = [];
    for (const f of files) {
      const names = new Set<string>();
      for (const m of f.text.matchAll(/\b(?:const|let)\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*['"]var\(/g)) names.add(m[1]);
      if (f.path === 'lib/foer/foer-tokens.ts') ['GOLD', 'NAVY', 'BG_DARK', 'TOOLTIP_BG', 'TOOLTIP_TEXT'].forEach((n) => names.add(n));
      if (!names.size) continue;
      f.text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\$\{\s*([A-Za-z_]\w*)\s*\}([0-9a-fA-F]{2})(?![0-9a-zA-Z])/g)) {
          if (names.has(m[1])) hits.push({ file: f.path, line: i + 1, code: line.trim().slice(0, 120) });
        }
      });
    }
    expect(fmt(hits)).toBe('');
  });
});
