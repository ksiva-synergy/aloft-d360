import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Enforces the module boundary in ADR-001/002: the flow core and capability contracts stay free of
// the web framework, the database client and the conversational (Inspector) runtime, so they can run
// in a worker or behind another API without change. Adapters that need those live elsewhere.

const ROOTS = ['src/lib/flows', 'src/lib/capabilities'];
const FORBIDDEN = [
  /^next(\/|$)/,
  /^next-auth/,
  /^@prisma\/client/,
  /^@\/lib\/(db|prisma)$/,
  /^@\/lib\/inspector(\/|$)/,
  /^@\/lib\/construction(\/|$)/,
  /^@\/middleware(\/|$)/,
  /^@aws-sdk\//,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('flow core boundary', () => {
  it('imports nothing from the framework, the database or the Inspector runtime', () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.resolve(root))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
          if (FORBIDDEN.some((re) => re.test(m[1]!))) violations.push(`${path.relative(process.cwd(), file)} → ${m[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
