/**
 * Built-in role defaults changed in Users → Section access (`section-default:*` keys on the role):
 * they replace the shipped default for that role and section, can lower as well as raise, never
 * pass a section's ceiling, and never affect platform admins or people with a custom role.
 */
import { describe, expect, it } from 'vitest';
import {
  ROLE_DEFAULT_PREFIX,
  SECTION_BY_ID,
  defaultLevels,
  keysForLevels,
  resolveSectionLevels,
  roleBaseKey,
  roleDefaultKey,
  roleDefaultKeysFor,
  roleDefaultOverridesFromKeys,
} from '../registry';

describe('built-in role default overrides', () => {
  it('raise and lower a built-in role for people who hold it', () => {
    const keys = [roleDefaultKey('member', 'build.automate', 'manage'), roleDefaultKey('member', 'build.agents', 'none')];
    const levels = resolveSectionLevels(['member'], keys);
    expect(levels['build.automate']).toBe('manage');
    expect(levels['build.agents']).toBe('none');
    // Untouched sections keep the shipped default.
    expect(levels['build.inspector']).toBe(SECTION_BY_ID.get('build.inspector')!.defaults.member);
  });

  it("only apply to the role they name, even if a person's keys hold another role's overrides", () => {
    const keys = [roleDefaultKey('admin', 'build.teach', 'none')];
    expect(resolveSectionLevels(['member'], keys)['build.teach']).toBe('none');
    expect(resolveSectionLevels(['admin'], keys)['build.teach']).toBe('none');
    expect(resolveSectionLevels(['admin'], [])['build.teach']).toBe('view');
  });

  it('still combine with bundles (a bundle can add back what a default took away)', () => {
    const keys = [roleDefaultKey('admin', 'build.metrics', 'none'), ...keysForLevels({ 'build.metrics': 'manage' })];
    expect(resolveSectionLevels(['admin'], keys)['build.metrics']).toBe('manage');
  });

  it('never pass the section ceiling: no Manage on Data Estate or view-only sections', () => {
    const estate = [...SECTION_BY_ID.values()].find((s) => s.manageIsPlatformAdminOnly)!;
    const levels = resolveSectionLevels(['admin'], [roleDefaultKey('admin', estate.id, 'manage')]);
    expect(levels[estate.id]).toBe('view');
    expect(roleDefaultOverridesFromKeys([roleDefaultKey('admin', estate.id, 'manage')]).admin?.[estate.id]).toBe('view');
  });

  it('do not touch platform admins or people with a custom role', () => {
    const keys = [roleDefaultKey('member', 'build.agents', 'none')];
    expect(resolveSectionLevels(['platform_admin'], keys)['build.agents']).toBe('manage');
    const custom = [roleBaseKey('member'), ...keysForLevels({ 'build.agents': 'manage' }), ...keys];
    expect(resolveSectionLevels(['member'], custom)['build.agents']).toBe('manage');
  });

  it('ignore malformed and unknown keys', () => {
    const parsed = roleDefaultOverridesFromKeys([
      `${ROLE_DEFAULT_PREFIX}platform_admin:build.agents:none`,
      `${ROLE_DEFAULT_PREFIX}member:no.such.section:view`,
      `${ROLE_DEFAULT_PREFIX}member:build.agents:owner`,
      `${ROLE_DEFAULT_PREFIX}member:build.agents:view:extra`,
      'section:build.agents:view',
    ]);
    expect(parsed).toEqual({});
  });

  it('store only cells that differ from the shipped default', () => {
    const shipped = defaultLevels('member');
    expect(roleDefaultKeysFor('member', shipped)).toEqual([]);
    expect(roleDefaultKeysFor('member', { ...shipped, 'build.automate': 'manage' })).toEqual([roleDefaultKey('member', 'build.automate', 'manage')]);
  });

  it('defaultLevels gives what a role gives today when passed its overrides (custom roles start from it)', () => {
    const overrides = roleDefaultOverridesFromKeys([roleDefaultKey('admin', 'build.teach', 'manage')]).admin;
    expect(defaultLevels('admin', overrides)['build.teach']).toBe('manage');
    expect(defaultLevels('admin')['build.teach']).toBe('view');
  });
});
