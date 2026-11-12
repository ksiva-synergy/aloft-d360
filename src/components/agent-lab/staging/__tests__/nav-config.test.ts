import { describe, expect, it } from 'vitest';
import { resolveSectionLevels } from '@/lib/sections/registry';
import { NAV_GROUPS, filterNavGroups, flatNavItems, isFlatNav, primaryNavHref, showHomeInNav } from '../nav-config';

describe('member nav', () => {
  const memberLevels = resolveSectionLevels(['member'], []);

  it('lands on Ask Data, not Home', () => {
    expect(showHomeInNav(memberLevels)).toBe(false);
    expect(primaryNavHref(memberLevels)).toBe('/inspector');
  });

  it('shows one flat group (Build pages only)', () => {
    const groups = filterNavGroups(NAV_GROUPS, memberLevels);
    expect(isFlatNav(groups)).toBe(true);
    expect(flatNavItems(groups).map((i) => i.href)).toEqual([
      '/inspector',
      '/agent-lab/agents',
      '/agent-lab/history',
    ]);
  });
});
