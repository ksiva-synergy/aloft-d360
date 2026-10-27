import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import tailwindConfig from '../../tailwind.config.js';

/**
 * Tailwind only generates CSS for classes it finds in the files listed in `content`. When the pages moved from
 * `src/app` to `src/views` and the folder was not listed, every class used only there (for example the login page's
 * `lg:flex`) vanished and the pages rendered unstyled. Logic tests do not notice that, so this one does.
 */
const SRC = path.resolve(__dirname, '../../src');
const REPO = path.resolve(__dirname, '../..');

function dirsWithMarkup(dir = SRC, out = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      dirsWithMarkup(full, out);
    } else if (/\.(tsx|jsx)$/.test(name) && !/\.test\./.test(name)) {
      out.add(path.relative(REPO, path.dirname(full)).replace(/\\/g, '/'));
    }
  }
  return out;
}

describe('tailwind content globs', () => {
  const content = ((tailwindConfig as { content: string[] }).content ?? []).map((g) => g.replace(/^\.\//, ''));
  // A folder is covered when some glob's static prefix (the part before `/**`) contains it.
  const covers = (dir: string) =>
    content.some((g) => {
      const prefix = g.split('/**')[0];
      return dir === prefix || dir.startsWith(prefix + '/');
    });

  it('covers every source folder that contains JSX', () => {
    const uncovered = [...dirsWithMarkup()].filter((d) => !covers(d));
    expect(uncovered).toEqual([]);
  });

  it('lists the Vite app itself (index.html and web/src)', () => {
    expect(content).toContain('web/index.html');
    expect(content.some((g) => g.startsWith('web/src/'))).toBe(true);
  });

  it('includes src/views, where the pages live', () => {
    expect(content.some((g) => g.startsWith('src/views/'))).toBe(true);
  });
});
