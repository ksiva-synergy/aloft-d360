import { describe, expect, it } from 'vitest';
import { groupAccessRequests, type AccessRequestRow } from '@/components/access/requests/RequestList';

const base = (over: Partial<AccessRequestRow>): AccessRequestRow => ({
  id: 'r1',
  number: 'ACC-1',
  requesterId: 'u1',
  requester: 'Ana',
  targetType: 'path',
  target: 'a.b.c',
  level: 'query',
  durationDays: 30,
  reason: 'need',
  ticketRef: null,
  status: 'pending',
  approvers: ['Owner'],
  canDecide: false,
  decidedBy: null,
  decidedAt: null,
  grantedUntil: null,
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  ...over,
});

describe('groupAccessRequests', () => {
  it('groups rows that share bundle-* ticketRef', () => {
    const ref = 'bundle-1';
    const grouped = groupAccessRequests([
      base({ id: 'a', number: 'ACC-1', ticketRef: ref, target: 'a.b.t1' }),
      base({ id: 'b', number: 'ACC-2', ticketRef: ref, target: 'a.b.t2' }),
      base({ id: 'c', number: 'ACC-3', ticketRef: 'FIN-9' }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ kind: 'bundle', ticketRef: ref });
    expect(grouped[0].kind === 'bundle' && grouped[0].requests).toHaveLength(2);
    expect(grouped[1]).toMatchObject({ kind: 'single', request: { id: 'c' } });
  });
});
