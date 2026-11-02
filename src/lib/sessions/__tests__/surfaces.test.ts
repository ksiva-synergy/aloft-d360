import { describe, expect, it } from 'vitest';
import { normalizeSurface, parseSurfaceList, sessionOpenHref, surfacesWhere, surfaceWhere } from '@/lib/sessions/surfaces';

describe('session surfaces', () => {
  it('treats missing or unknown surfaces as Workbench', () => {
    expect(normalizeSurface(null)).toBe('workbench');
    expect(normalizeSurface('nope')).toBe('workbench');
    expect(normalizeSurface('agent_use')).toBe('agent_use');
  });

  it('opens each surface in its own place', () => {
    expect(sessionOpenHref({ id: 's1', surface: null })).toBe('/agent-lab/agents/workbench/s1');
    expect(sessionOpenHref({ id: 's1', surface: 'inspector' })).toBe('/inspector/s1');
    expect(sessionOpenHref({ id: 's1', surface: 'teach' })).toBe('/agent-lab/teach/s1');
    expect(sessionOpenHref({ id: 's1', surface: 'agent_use', progress: { agentUse: { agentId: 'a1', slug: 'tracer' } } })).toBe(
      '/agent-lab/agents/tracer?chat=s1',
    );
    // An agent chat never falls through into the Workbench, even without its link.
    expect(sessionOpenHref({ id: 's1', surface: 'agent_use', progress: null })).toBe('/agent-lab/agents');
  });

  it('builds list filters', () => {
    expect(parseSurfaceList('workbench, inspector,bogus')).toEqual(['workbench', 'inspector']);
    expect(surfacesWhere([])).toEqual({});
    expect(surfacesWhere(['inspector'])).toEqual({ surface: 'inspector' });
    expect(surfaceWhere('workbench')).toEqual({ OR: [{ surface: 'workbench' }, { surface: null }] });
    expect(surfacesWhere(['workbench', 'inspector'])).toEqual({
      OR: [{ surface: 'workbench' }, { surface: null }, { surface: 'inspector' }],
    });
  });
});
