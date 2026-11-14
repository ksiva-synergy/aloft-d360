import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMPILER_VERSION } from '@/lib/powerbi/dax-sql-compile';

/**
 * Translate checkpoints skip a measure while its fingerprint (which includes COMPILER_VERSION) is
 * unchanged. Changing the compiler without bumping the version silently re-checks stale SQL
 * (happened 2026-11-14: a Vessel regression run skipped 73/73 measures). This test fails when
 * the compiler sources change but COMPILER_VERSION does not.
 *
 * After an intentional compiler change: bump COMPILER_VERSION, then run
 *   UPDATE_COMPILER_LOCK=1 npx vitest run src/lib/powerbi/__tests__/compiler-version.test.ts
 */
const SOURCES = ['dax-sql-compile.ts', 'dax-parse.ts', 'm-lineage.ts'];
const LOCK = join(__dirname, 'fixtures', 'compiler-version.lock.json');

function sourceHash(): string {
  const h = createHash('sha256');
  for (const f of SOURCES) {
    const text = readFileSync(join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
    // the version constant itself is not part of the hash
    h.update(text.replace(/export const COMPILER_VERSION = '[^']*';/, ''));
  }
  return h.digest('hex');
}

describe('COMPILER_VERSION guard', () => {
  it('is bumped whenever the compiler sources change', () => {
    const hash = sourceHash();
    if (process.env.UPDATE_COMPILER_LOCK === '1') {
      writeFileSync(LOCK, `${JSON.stringify({ version: COMPILER_VERSION, hash }, null, 2)}\n`);
      return;
    }
    const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as { version: string; hash: string };
    if (lock.hash !== hash) {
      expect(
        COMPILER_VERSION,
        'Compiler sources changed: bump COMPILER_VERSION in dax-sql-compile.ts, then refresh the lock with UPDATE_COMPILER_LOCK=1',
      ).not.toBe(lock.version);
    }
  });
});
