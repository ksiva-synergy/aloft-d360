import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const API = join(__dirname, '..');

const ROUTES = [
  'summary/route.ts',
  'workspaces/route.ts',
  'models/route.ts',
  'models/[id]/route.ts',
  'domains/route.ts',
  'conflicts/route.ts',
  'conflicts/[id]/route.ts',
];

describe('powerbi API routes', () => {
  it.each(ROUTES)('%s checks estate.powerbi section', (rel) => {
    const text = readFileSync(join(API, rel), 'utf8');
    expect(text).toContain('denyUnlessSection');
    expect(text).toContain('estate.powerbi');
  });

  it('conflicts PATCH requires manage', () => {
    const text = readFileSync(join(API, 'conflicts/[id]/route.ts'), 'utf8');
    expect(text).toContain("['estate.powerbi', 'manage']");
  });
});
