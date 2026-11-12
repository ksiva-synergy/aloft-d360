import { describe, expect, it } from 'vitest';
import { EDITABLE_PERMISSION_KEYS, PERMISSION_CATALOG, PERMISSION_GROUP_LABEL, planPermissionChange } from '@/lib/permission-catalog';
import { PERMISSIONS } from '@/lib/rbac';
import { CAPABILITY_PERMISSIONS } from '@/lib/capabilities/builtin';
import { RAW_SQL_PERMISSION } from '@/lib/flows/policy';

describe('permission catalog', () => {
  it('lists every permission the code defines, once, each in a known group', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const defined = new Set([...Object.values(PERMISSIONS), ...Object.values(CAPABILITY_PERMISSIONS), RAW_SQL_PERMISSION]);
    expect([...defined].filter((k) => !keys.includes(k))).toEqual([]);
    expect(keys.filter((k) => !defined.has(k))).toEqual([]);
    for (const p of PERMISSION_CATALOG) expect(PERMISSION_GROUP_LABEL[p.group]).toBeTruthy();
  }, 30_000);

  it("keeps cross-user history with platform admins", () => {
    expect(EDITABLE_PERMISSION_KEYS.has('session:read:all')).toBe(false);
    expect(EDITABLE_PERMISSION_KEYS.has('connector:external')).toBe(true);
  });

  it('plans adds and removes among editable keys only, never touching section or unknown keys', () => {
    const current = ['inspector:use', 'session:read', 'section:build.automate:manage', 'section-default:admin:build.teach:none', 'session:read:all'];
    const requested = ['inspector:use', 'connector:external', 'not:a:key', 'section:govern.users:manage'];
    expect(planPermissionChange(current, requested)).toEqual({ add: ['connector:external'], remove: ['session:read'] });
  });
});
