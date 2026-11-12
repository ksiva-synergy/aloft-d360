/**
 * Section dependencies (uses.ts): only the exact embedded calls go through the host section, and the
 * matrix warns only when a host is open but what it still needs is missing.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../registry';
import { SECTION_USES, sectionUseGaps, embeddedCallRequirements, usesOf } from '../uses';

describe('embeddedCallRequirements', () => {
  it("lets Automate make exactly its picker's calls into Connections and Knowledge", () => {
    expect(embeddedCallRequirements('GET', '/api/connections')).toEqual([['build.automate', 'view']]);
    expect(embeddedCallRequirements('POST', '/api/connections/c-1/extract')).toEqual([['build.automate', 'manage']]);
    expect(embeddedCallRequirements('get', '/api/knowledge')).toEqual([['build.automate', 'view']]);
    expect(embeddedCallRequirements('POST', '/api/knowledge/search')).toEqual([['build.automate', 'manage']]);
  });

  it('allows nothing else on those sections', () => {
    for (const [method, path] of [
      ['POST', '/api/connections'],
      ['PATCH', '/api/connections/c-1'],
      ['DELETE', '/api/connections/c-1'],
      ['GET', '/api/connections/c-1/browse'],
      ['POST', '/api/connections/c-1/test'],
      ['GET', '/api/connections/c-1/extract'],
      ['POST', '/api/knowledge'],
      ['GET', '/api/knowledge/k-1/documents'],
      ['GET', '/api/knowledge/search-history'],
      ['GET', '/api/users'],
    ]) {
      expect(embeddedCallRequirements(method, path), `${method} ${path}`).toEqual([]);
    }
  });

  it('only names real sections', () => {
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const u of SECTION_USES) {
      expect(ids.has(u.host), u.host).toBe(true);
      expect(ids.has(u.uses), u.uses).toBe(true);
    }
    expect(usesOf('build.automate').map((u) => u.uses).sort()).toEqual(['govern.connections', 'memory.knowledge']);
  });
});

describe('sectionUseGaps', () => {
  it('warns when Automate is open but adding a connection is not', () => {
    const gaps = sectionUseGaps({ 'build.automate': 'manage', 'govern.connections': 'none', 'memory.knowledge': 'none' });
    expect(gaps.map((g) => [g.use.id, g.needed])).toEqual([['automate-connections', 'manage']]);
    expect(gaps[0].message).toMatch(/add a new connection from a flow they also need Connections \(Manage\)/);
  });

  it('says nothing when the host is closed, the need is met, or nothing extra is needed', () => {
    expect(sectionUseGaps({ 'build.automate': 'none' })).toEqual([]);
    expect(sectionUseGaps({ 'build.automate': 'manage', 'govern.connections': 'manage' })).toEqual([]);
    // Knowledge is fully covered by the host: no warning even with no Knowledge section.
    expect(sectionUseGaps({ 'build.automate': 'manage', 'govern.connections': 'manage', 'memory.knowledge': 'none' })).toEqual([]);
  });
});
