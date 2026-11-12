import { afterEach, describe, expect, it } from 'vitest';
import { isEntraAdminGroupMember, ssoRequiresAdminApproval } from '@/lib/sso-access';

describe('ssoRequiresAdminApproval', () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults to requiring approval', () => {
    delete process.env.SSO_REQUIRE_ADMIN_APPROVAL;
    delete process.env.SSO_JIT_AUTO_ACTIVATE;
    expect(ssoRequiresAdminApproval()).toBe(true);
  });

  it('honours SSO_JIT_AUTO_ACTIVATE', () => {
    process.env.SSO_JIT_AUTO_ACTIVATE = 'true';
    expect(ssoRequiresAdminApproval()).toBe(false);
  });

  it('honours SSO_REQUIRE_ADMIN_APPROVAL=false', () => {
    process.env.SSO_REQUIRE_ADMIN_APPROVAL = 'false';
    expect(ssoRequiresAdminApproval()).toBe(false);
  });
});

describe('isEntraAdminGroupMember', () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns false when groups claim is missing', () => {
    process.env.AZURE_AD_ADMIN_GROUP_IDS = 'g1';
    expect(isEntraAdminGroupMember(undefined)).toBe(false);
  });

  it('matches configured admin group ids', () => {
    process.env.AZURE_AD_ADMIN_GROUP_IDS = 'g1, g2';
    expect(isEntraAdminGroupMember(['other', 'g2'])).toBe(true);
  });
});
