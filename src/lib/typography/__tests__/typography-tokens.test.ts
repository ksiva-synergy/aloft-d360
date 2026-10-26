import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FONT_MONO, FONT_SANS, TYPE_TOKEN_NAMES, type } from '../tokens';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(HERE, '../../../styles/typography.css'), 'utf8');
const cfg = readFileSync(resolve(HERE, '../../../../tailwind.config.js'), 'utf8');

describe('typography tokens', () => {
  it('font stacks match typography.css', () => {
    expect(css).toContain(`--font-sans: ${FONT_SANS};`);
    expect(css).toContain(`--font-mono: ${FONT_MONO};`);
  });

  it.each(TYPE_TOKEN_NAMES)('%s is defined in CSS and Tailwind', (name) => {
    for (const part of ['size', 'weight', 'lh', 'ls']) expect(css).toContain(`--type-${name}-${part}:`);
    expect(css).toContain(`.type-${name} {`);
    if (name !== 'code-inline') expect(cfg).toContain(`'${name}'`);
    expect(type[name].fontFamily).toBe(name.startsWith('code') ? 'var(--font-mono)' : 'var(--font-sans)');
  });

  it('uses only the allowed weights', () => {
    const weights = [...css.matchAll(/--type-[a-z-]+-weight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(weights)).toEqual(new Set([400, 500, 600]));
  });
});
