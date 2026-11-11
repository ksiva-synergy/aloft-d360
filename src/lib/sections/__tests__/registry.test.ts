import { describe, expect, it } from 'vitest';
import {
  SECTIONS,
  baseFromKeys,
  bundleCeiling,
  defaultLevels,
  roleBaseKey,
  splitSectionRoles,
  hiddenInNav,
  keysForLevels,
  levelsFromKeys,
  resolveSectionLevels,
  sectionForPath,
  sectionPermissionKey,
  type SectionLevels,
} from '../registry';

const filterOutHidden = (levels: SectionLevels, hrefs: string[]) => hrefs.filter((h) => !hiddenInNav(levels, h));

const ESTATE = SECTIONS.filter((s) => s.group === 'estate').map((s) => s.id);

describe('section levels', () => {
  it('platform admins can manage every section (view-only sections stay view)', () => {
    const levels = resolveSectionLevels(['platform_admin'], []);
    for (const s of SECTIONS) expect(levels[s.id]).toBe(s.viewOnly ? 'view' : 'manage');
  });

  it('admins can view the Data Estate but take no actions', () => {
    const levels = resolveSectionLevels(['admin'], []);
    for (const id of ESTATE) expect(levels[id]).toBe('view');
  });

  it('a bundle cannot give manage on the Data Estate to anyone but a platform admin', () => {
    const perms = ESTATE.map((id) => sectionPermissionKey(id, 'manage'));
    const levels = resolveSectionLevels(['admin', 'estate_operator'], perms);
    for (const id of ESTATE) expect(levels[id]).toBe('view');
  });

  it('members and read-only users cannot open the Data Estate', () => {
    for (const role of ['member', 'readonly']) {
      const levels = resolveSectionLevels([role], []);
      for (const id of ESTATE) expect(levels[id]).toBe('none');
    }
  });

  it('a person with no roles counts as Member', () => {
    expect(resolveSectionLevels([], [])).toEqual(resolveSectionLevels(['member'], []));
  });

  it('a bundle can give view on one estate section to a member', () => {
    const levels = resolveSectionLevels(['member'], [sectionPermissionKey('estate.catalog', 'view')]);
    expect(levels['estate.catalog']).toBe('view');
    expect(levels['estate.jobs']).toBe('none');
  });

  it('a bundle can give manage on a section that allows it', () => {
    const levels = resolveSectionLevels(['admin'], new Set([sectionPermissionKey('build.automate', 'manage')]));
    expect(levels['build.automate']).toBe('manage');
    expect(levels['build.teach']).toBe('view');
  });
});

describe('paths', () => {
  it('maps estate pages to their section, object pages to the catalog', () => {
    expect(sectionForPath('/agent-lab/estate')?.id).toBe('estate.overview');
    expect(sectionForPath('/agent-lab/estate/jobs/abc')?.id).toBe('estate.jobs');
    expect(sectionForPath('/agent-lab/estate/object/123')?.id).toBe('estate.catalog');
    expect(sectionForPath('/inspector/dashboards/9')?.id).toBe('build.dashboards');
    expect(sectionForPath('/inspector')?.id).toBe('build.inspector');
  });

  it('hides every section at none', () => {
    const member = resolveSectionLevels(['member'], []);
    expect(hiddenInNav(member, '/agent-lab/estate/catalog')).toBe(true);
    expect(hiddenInNav(member, '/agent-staging/users')).toBe(true);
    expect(hiddenInNav(member, '/agent-lab/automate')).toBe(true);
    expect(hiddenInNav(member, '/inspector/dashboards')).toBe(true);
    expect(hiddenInNav(null, '/agent-lab/estate/catalog')).toBe(false);
    expect(filterOutHidden(member, ['/agent-lab/estate', '/inspector'])).toEqual(['/inspector']);
  });
});

describe('govern defaults', () => {
  it('admins can view Govern sections but not change them (own connections excepted)', () => {
    const levels = resolveSectionLevels(['admin'], []);
    for (const id of ['govern.models', 'govern.users', 'govern.data-access', 'govern.cost', 'govern.policies', 'govern.audit']) {
      expect(levels[id]).toBe('view');
    }
    expect(levels['govern.connections']).toBe('manage');
  });

  it('platform admins manage Govern sections', () => {
    const levels = resolveSectionLevels(['platform_admin'], []);
    for (const id of ['govern.models', 'govern.users', 'govern.data-access', 'govern.cost', 'govern.policies']) {
      expect(levels[id]).toBe('manage');
    }
  });

  it('a bundle can give an admin manage on one Govern section', () => {
    const levels = resolveSectionLevels(['admin'], [sectionPermissionKey('govern.cost', 'manage')]);
    expect(levels['govern.cost']).toBe('manage');
    expect(levels['govern.users']).toBe('view');
  });

  it('members see only Ask Data, Agents, and History in Build by default', () => {
    const levels = resolveSectionLevels(['member'], []);
    expect(levels['build.inspector']).toBe('manage');
    expect(levels['build.agents']).toBe('manage');
    expect(levels['build.history']).toBe('view');
    for (const id of ['build.dashboards', 'build.metrics', 'build.teach', 'build.automate', 'build.performance', 'build.bandits']) {
      expect(levels[id]).toBe('none');
    }
    expect(levels['home']).toBe('none');
  });

  it('members have no Govern sections unless a bundle adds them', () => {
    const levels = resolveSectionLevels(['member'], []);
    expect(levels['govern.connections']).toBe('none');
    for (const id of ['govern.models', 'govern.users', 'govern.data-access', 'govern.cost', 'govern.policies', 'govern.audit']) {
      expect(levels[id]).toBe('none');
    }
    expect(levels['govern.docs']).toBe('none');
  });

  it('read-only users see docs only', () => {
    const levels = resolveSectionLevels(['readonly'], []);
    expect(levels['govern.connections']).toBe('none');
    expect(levels['govern.users']).toBe('none');
    expect(levels['govern.docs']).toBe('view');
  });

  it('a bundle can give a member view on cost without manage', () => {
    const levels = resolveSectionLevels(['member'], [sectionPermissionKey('govern.cost', 'view')]);
    expect(levels['govern.cost']).toBe('view');
    expect(levels['govern.users']).toBe('none');
  });
});

describe('bundle keys', () => {
  it('round-trips levels through permission keys', () => {
    const keys = keysForLevels({ 'govern.cost': 'view', 'build.automate': 'manage', 'govern.users': 'none' });
    expect(keys.sort()).toEqual(['section:build.automate:manage', 'section:govern.cost:view']);
    expect(levelsFromKeys(keys)).toEqual({ 'govern.cost': 'view', 'build.automate': 'manage' });
  });

  it('never stores manage on Data Estate or view-only sections', () => {
    const keys = keysForLevels({ 'estate.jobs': 'manage', 'govern.audit': 'manage' });
    expect(keys.sort()).toEqual(['section:estate.jobs:view', 'section:govern.audit:view']);
    expect(bundleCeiling(SECTIONS.find((s) => s.id === 'estate.catalog')!)).toBe('view');
    expect(bundleCeiling(SECTIONS.find((s) => s.id === 'govern.cost')!)).toBe('manage');
  });

  it('ignores keys for unknown sections', () => {
    expect(levelsFromKeys(['section:nope:manage', 'user:read'])).toEqual({});
  });
});

describe('custom roles', () => {
  const analyst = [roleBaseKey('member'), ...keysForLevels({ ...defaultLevels('member'), 'build.dashboards': 'none', 'govern.cost': 'view' })];

  it('set every section exactly, including taking access away from the base role', () => {
    const levels = resolveSectionLevels(['member'], analyst);
    expect(levels['build.dashboards']).toBe('none');
    expect(levels['build.agents']).toBe('manage');
    expect(levels['govern.cost']).toBe('view'); // Member default is none
  });

  it('can be combined with bundles, which still add', () => {
    const levels = resolveSectionLevels(['member'], [...analyst, sectionPermissionKey('build.dashboards', 'view')]);
    expect(levels['build.dashboards']).toBe('view');
  });

  it('never give Data Estate actions', () => {
    const keys = [roleBaseKey('admin'), ...keysForLevels({ 'estate.jobs': 'manage' })];
    expect(resolveSectionLevels(['admin'], keys)['estate.jobs']).toBe('view');
  });

  it('do not affect platform admins', () => {
    expect(resolveSectionLevels(['platform_admin'], [roleBaseKey('readonly')])['govern.users']).toBe('manage');
  });

  it('are told apart from bundles by their base key', () => {
    expect(baseFromKeys(analyst)).toBe('member');
    expect(baseFromKeys(['section:govern.cost:view'])).toBeNull();
    const split = splitSectionRoles([
      { role: { id: 'm', name: 'member' } },
      { role: { id: 'r1', name: 'Analyst', permissions: [{ permission: { key: roleBaseKey('member') } }] } },
      { role: { id: 'b1', name: 'Cost viewers', permissions: [] } },
    ]);
    expect(split.customRole).toEqual({ id: 'r1', name: 'Analyst', base: 'member' });
    expect(split.bundles).toEqual([{ id: 'b1', name: 'Cost viewers' }]);
  });
});
