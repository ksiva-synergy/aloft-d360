import { describe, expect, it } from 'vitest';
import { sectionIdForApiPath } from '../api-guard';

describe('sectionIdForApiPath', () => {
  it('maps product APIs to section ids', () => {
    expect(sectionIdForApiPath('/api/inspector/chat')).toBe('build.inspector');
    expect(sectionIdForApiPath('/api/inspector/dashboards/x')).toBe('build.dashboards');
    expect(sectionIdForApiPath('/api/agent-lab/flows/simulate')).toBe('build.automate');
    expect(sectionIdForApiPath('/api/agent-lab/workbench/sessions')).toBe('build.agents');
    expect(sectionIdForApiPath('/api/agent-lab/memory/browse')).toBe('memory.foer');
    expect(sectionIdForApiPath('/api/dashboard/summary')).toBe('home');
  });

  it('leaves universal paths unmapped', () => {
    expect(sectionIdForApiPath('/api/access/me')).toBeNull();
    expect(sectionIdForApiPath('/api/me/sections')).toBeNull();
  });
});
