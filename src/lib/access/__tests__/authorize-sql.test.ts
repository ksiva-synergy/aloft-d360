import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessModel } from '../engine';
import type { AccessPrincipal } from '../types';

const { logs, state } = vi.hoisted(() => ({
  logs: [] as Record<string, unknown>[],
  state: { model: null as unknown as AccessModel },
}));
vi.mock('@/lib/db', () => ({
  prisma: { accessDecisionLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => logs.push(data)) } },
}));
vi.mock('../model-store', () => ({ getAccessModel: vi.fn(async () => ({ model: state.model, version: 1n })) }));

import { authorizeSql } from '../authorize';

const empty: AccessModel = { rules: [], protections: new Map(), targets: [], protectionGrants: [], membersByUser: new Map(), bootstrapOpen: false };
const user = (roles: string[]): AccessPrincipal => ({ kind: 'user', orgId: 'org', userId: 'u1', departmentIds: [], clearance: 'internal', roles });
const ctx = { surface: 'sql' as const, sessionId: 's1' };

beforeEach(() => {
  process.env.ACCESS_MODE = 'enforce';
  logs.length = 0;
  state.model = empty;
});
afterEach(() => {
  delete process.env.ACCESS_MODE;
});

describe('authorizeSql', () => {
  it('a platform admin passes when only table names could not be resolved, and it is logged', async () => {
    await expect(authorizeSql(user(['platform_admin']), 'SELECT * FROM payroll', 'query', ctx)).resolves.toEqual({ tier: 'internal' });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ decision: 'allow', reason: 'platform_admin_unresolved', user_id: 'u1' });
  });

  it('anyone else is refused for unresolved names', async () => {
    await expect(authorizeSql(user(['member']), 'SELECT * FROM payroll', 'query', ctx)).rejects.toThrow();
    expect(logs[0]).toMatchObject({ decision: 'deny', reason: 'sql_unresolved' });
  });

  it('a platform admin is still refused for writes and forbidden catalogs', async () => {
    await expect(authorizeSql(user(['platform_admin']), 'UPDATE a.b.c SET x = 1', 'query', ctx)).rejects.toThrow();
    await expect(authorizeSql(user(['platform_admin']), 'SELECT * FROM system.access.audit', 'query', ctx)).rejects.toThrow();
  });

  it('allowed reads by people are logged, not just Confidential ones', async () => {
    await authorizeSql(user(['platform_admin']), 'SELECT * FROM a.b.c', 'query', ctx);
    expect(logs).toEqual([expect.objectContaining({ decision: 'allow', paths: ['a.b.c'] })]);
  });

  it('a comma join to a table the person cannot use is refused (review C1)', async () => {
    state.model = { ...empty, rules: [{ holder: { kind: 'person', id: 'u1' }, path: 'a', effect: 'use', allowExport: false, expiresAt: null }] };
    await expect(authorizeSql(user(['member']), 'SELECT * FROM a.b.c x, secret.hr.pay y', 'query', ctx)).rejects.toThrow();
  });
});

describe('mode settings (review H3)', () => {
  it('an unrecognised ACCESS_MODE enforces and is reported', async () => {
    const { accessMode, accessConfigErrors } = await import('../config');
    process.env.ACCESS_MODE = 'enforced';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(accessMode()).toBe('enforce');
    expect(accessConfigErrors().join(' ')).toMatch(/"enforced" is not recognised/);
    process.env.ACCESS_MODE = 'observe';
    expect(accessMode()).toBe('observe');
    expect(accessConfigErrors()).toEqual([]);
  });
});
