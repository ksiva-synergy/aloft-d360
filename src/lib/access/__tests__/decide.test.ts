import { describe, expect, it } from 'vitest';
import { decideObject } from '@/lib/access/decide';
import type { PolicySnapshot } from '@/lib/access/types';

const emptyPolicy = (overrides: Partial<PolicySnapshot> = {}): PolicySnapshot => ({
  orgId: 'org-1',
  version: 0n,
  grants: [],
  labels: [],
  clearances: new Map(),
  membersByUser: new Map(),
  legacyOpen: false,
  ...overrides,
});

describe('decideObject', () => {
  it('denies when no grants and not legacy open', () => {
    const d = decideObject(
      { userId: 'u1', departmentIds: [], clearance: 'internal' },
      'cat.schema.table',
      'query',
      emptyPolicy(),
    );
    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('no_grant');
  });

  it('allows when legacyOpen (bootstrap)', () => {
    const d = decideObject(
      { userId: 'u1', departmentIds: [], clearance: 'internal' },
      'cat.schema.table',
      'query',
      emptyPolicy({ legacyOpen: true }),
    );
    expect(d.decision).toBe('allow');
  });

  it('allows when a catalog grant covers the table', () => {
    const policy = emptyPolicy({
      grants: [{
        principalType: 'user',
        principalId: 'u1',
        path: 'cat',
        pathDepth: 1,
        level: 'query',
        effect: 'allow',
        expiresAt: null,
      }],
    });
    const d = decideObject(
      { userId: 'u1', departmentIds: [], clearance: 'internal' },
      'cat.schema.table',
      'query',
      policy,
    );
    expect(d.decision).toBe('allow');
  });

  it('requires clearance for confidential labels', () => {
    const policy = emptyPolicy({
      legacyOpen: true,
      labels: [{ path: 'cat.schema.table', pathDepth: 3, label: 'confidential' }],
    });
    const d = decideObject(
      { userId: 'u1', departmentIds: [], clearance: 'internal' },
      'cat.schema.table',
      'query',
      policy,
    );
    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('needs_clearance');
  });
});
