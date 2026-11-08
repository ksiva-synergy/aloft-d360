// @vitest-environment jsdom
/**
 * Requests & log tab and "My data access": approve from the inbox, history window, and asking.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestsView } from '../RequestsView';

vi.mock('../AccessLogView', () => ({ AccessLogView: () => <div>decision log</div> }));
vi.mock('@/lib/navigation', () => ({ useSearchParams: () => new URLSearchParams('tag=comp') }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u-ana' } } }) }));

import MyAccessPage from '@/views/my-access';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const pending = {
  id: 'r1',
  number: 'ACC-0007',
  requesterId: 'u-ana',
  requester: 'Ana Rao',
  targetType: 'tag',
  tagId: 'comp',
  target: 'Compensation',
  level: 'full',
  durationDays: 30,
  reason: 'Q4 crew cost review for Fleet B',
  ticketRef: 'FIN-221',
  status: 'pending',
  approvers: ['Olivia Owner'],
  canDecide: true,
  decidedBy: null,
  decidedAt: null,
  grantedUntil: null,
  createdAt: '2026-11-08T09:14:00Z',
  updatedAt: '2026-11-08T09:14:00Z',
};

function fakeApi() {
  const calls: { method: string; path: string; body?: any }[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    if (method === 'POST' && url.pathname === '/api/access/requests') return json(201, { request: { number: 'ACC-0008', approvers: 1 } });
    if (method === 'POST') return json(200, { status: 'approved' });
    if (url.pathname === '/api/access/requests/r1') {
      return json(200, { events: [{ id: 'e1', type: 'requested', actor: 'Ana Rao', ts: '2026-11-08T09:14:00Z', comment: 'Q4 crew cost review' }, { id: 'e2', type: 'routed', actor: 'system', ts: '2026-11-08T09:14:00Z', comment: null }] });
    }
    if (url.pathname === '/api/access/requests') {
      const view = url.searchParams.get('view');
      if (view === 'inbox') return json(200, { requests: [pending] });
      if (view === 'history') return json(200, { requests: [{ ...pending, canDecide: false, status: 'approved' }] });
      return json(200, { requests: [{ ...pending, canDecide: false }] });
    }
    if (url.pathname === '/api/access/notifications') {
      return json(200, { unread: 1, notifications: [{ id: 'n1', kind: 'approved', title: 'ACC-0005 was approved', body: 'Access until 8 Dec.', link: '/my-access', createdAt: '2026-11-08T10:00:00Z', read: false }] });
    }
    if (url.pathname === '/api/access/my-access') {
      if (url.searchParams.has('q')) return json(200, { tables: [{ path: 'curated_db.hr.payroll', kind: 'table' }] });
      return json(200, {
        me: { userId: 'u-ana', roles: ['member'] },
        groups: [],
        builtins: [{ id: 'member', name: 'Members' }],
        rules: [{ path: 'curated_db', access: 'use', through: 'built-in Members', expiresAt: null }],
        protections: [{ id: 'comp', name: 'Compensation', description: null, twoApprovals: false, myLevel: 'none' }],
      });
    }
    return json(404, { error: 'not found' });
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('RequestsView', () => {
  it('the inbox shows a waiting request; opening it shows the history; approving sends the decision', async () => {
    const calls = fakeApi();
    render(<RequestsView people={[]} meId="u-owner" />);
    expect(await screen.findByRole('tab', { name: 'To approve (1)' })).toBeTruthy();
    fireEvent.click(await screen.findByText('Compensation'));
    expect(await screen.findByText(/sent to approvers/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Level to approve'), { target: { value: 'aggregate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/access/requests/r1', body: { action: 'approve', level: 'aggregate', durationDays: 30 } }),
    );
  });

  it('history defaults to 30 days and can switch to 60 or 90, never more', async () => {
    const calls = fakeApi();
    render(<RequestsView people={[]} meId="u-owner" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Request history' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/access/requests?view=history&days=30')).toBe(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Last 90 days' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/access/requests?view=history&days=90')).toBe(true));
    expect(screen.queryByRole('radio', { name: /180/ })).toBeNull();
  });
});

describe('My data access', () => {
  it('shows what I can use and see, and sends a prefilled request', async () => {
    const calls = fakeApi();
    render(<MyAccessPage />);
    expect(await screen.findByText('built-in Members', { exact: false })).toBeTruthy();
    expect(screen.getByText('No access (sees •••)', { exact: false })).toBeTruthy();
    expect(screen.getByText('ACC-0005 was approved')).toBeTruthy();
    const form = screen.getByRole('region', { name: 'Ask for access' });
    fireEvent.change(within(form).getByLabelText('Why do you need it'), { target: { value: 'Q4 crew cost review for Fleet B' } });
    fireEvent.click(within(form).getByRole('button', { name: /Send request/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/access/requests',
        body: { targetType: 'tag', tagId: 'comp', level: 'full', durationDays: 30, reason: 'Q4 crew cost review for Fleet B' },
      }),
    );
    expect(await screen.findByText(/Sent as ACC-0008/)).toBeTruthy();
  });

  it('a short reason is caught before sending', async () => {
    const calls = fakeApi();
    render(<MyAccessPage />);
    const form = await screen.findByRole('region', { name: 'Ask for access' });
    fireEvent.change(within(form).getByLabelText('Why do you need it'), { target: { value: 'need it' } });
    fireEvent.click(within(form).getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText(/at least 20 characters/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
