import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessModel } from '../engine';
import type { AccessPrincipal } from '../types';

const state = vi.hoisted(() => ({ model: null as unknown as AccessModel }));
vi.mock('../model-store', () => ({ getAccessModel: vi.fn(async () => ({ model: state.model, version: 1n })) }));

import { visiblePathsSet } from '../visibility';

const ana: AccessPrincipal = { kind: 'user', orgId: 'org', userId: 'ana', departmentIds: [], clearance: 'internal', roles: ['member'] };

function modelWith(rules: AccessModel['rules']): AccessModel {
  return { rules, protections: new Map(), targets: [], protectionGrants: [], membersByUser: new Map(), bootstrapOpen: false };
}

afterEach(() => vi.useRealTimers());

describe('visibility cache (review H4)', () => {
  it('two different lists of the same length get their own answers', async () => {
    state.model = modelWith([{ holder: { kind: 'person', id: 'ana' }, path: 'a', effect: 'use', allowExport: false, expiresAt: null }]);
    const first = await visiblePathsSet(ana, 'query', ['a.s.t1', 'a.s.t2']);
    const second = await visiblePathsSet(ana, 'query', ['b.s.t1', 'b.s.t2']);
    expect([...first].sort()).toEqual(['a.s.t1', 'a.s.t2']);
    expect([...second]).toEqual([]);
  });

  it('a rule that expires stops applying within a minute, without a policy change', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    state.model = modelWith([
      { holder: { kind: 'person', id: 'ana' }, path: 'c', effect: 'use', allowExport: false, expiresAt: new Date('2026-11-09T10:00:30Z') },
    ]);
    expect([...(await visiblePathsSet(ana, 'query', ['c.s.t']))]).toEqual(['c.s.t']);
    vi.setSystemTime(new Date('2026-11-09T10:01:05Z'));
    expect([...(await visiblePathsSet(ana, 'query', ['c.s.t']))]).toEqual([]);
  });
});
