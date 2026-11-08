import { describe, expect, it } from 'vitest';
import { planMaintenance, type MaintRequest } from '../request-maintenance';

const NOW = new Date('2026-11-20T12:00:00Z').getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);
const req = (p: Partial<MaintRequest> & { id: string }): MaintRequest => ({
  status: 'pending',
  created_at: daysAgo(0),
  granted_until: null,
  requester_id: 'ana',
  routed_to: ['owner'],
  ...p,
});

describe('planMaintenance', () => {
  it('escalates open requests after 3 days, once', () => {
    const r = req({ id: 'a', created_at: daysAgo(4) });
    expect(planMaintenance([r], new Map(), NOW)).toEqual([{ kind: 'escalate', requestId: 'a' }]);
    expect(planMaintenance([r], new Map([['a', new Set(['escalated'])]]), NOW)).toEqual([]);
    expect(planMaintenance([req({ id: 'b', created_at: daysAgo(2) })], new Map(), NOW)).toEqual([]);
  });

  it('expires open requests after 14 days (also those waiting on a question)', () => {
    expect(planMaintenance([req({ id: 'a', created_at: daysAgo(15) }), req({ id: 'b', status: 'info_requested', created_at: daysAgo(20) })], new Map(), NOW)).toEqual([
      { kind: 'expire', requestId: 'a' },
      { kind: 'expire', requestId: 'b' },
    ]);
  });

  it('warns 3 days before approved access ends, once; records the end once', () => {
    const soon = req({ id: 's', status: 'approved', granted_until: new Date(NOW + 2 * 86_400_000) });
    const later = req({ id: 'l', status: 'approved', granted_until: new Date(NOW + 10 * 86_400_000) });
    const ended = req({ id: 'e', status: 'approved', granted_until: daysAgo(1) });
    expect(planMaintenance([soon, later, ended], new Map(), NOW)).toEqual([
      { kind: 'expiring_soon', requestId: 's' },
      { kind: 'access_ended', requestId: 'e' },
    ]);
    expect(planMaintenance([soon, ended], new Map([['s', new Set(['expiring_soon'])], ['e', new Set(['access_ended'])]]), NOW)).toEqual([]);
  });

  it('ignores closed requests and approved access without an end date', () => {
    expect(planMaintenance([req({ id: 'r', status: 'rejected', created_at: daysAgo(30) }), req({ id: 'p', status: 'approved' })], new Map(), NOW)).toEqual([]);
  });
});
