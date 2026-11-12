// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CostMonitorPage from '@/views/agent-staging/cost-monitor';
import type { BudgetPolicy, BudgetStatus, CostSummaryResponse, SpendEventRow } from '@/lib/spend/cost-types';

// Section level on Govern → Cost monitor (the real hook fetches /api/me/sections).
const costLevel = vi.hoisted(() => ({ value: 'manage' as 'none' | 'view' | 'manage' }));
vi.mock('@/lib/sections/useSectionLevels', () => ({
  useSectionLevel: () => costLevel.value,
  useSectionLevels: () => null,
}));

const days30 = (fill: number) => Array.from({ length: 30 }, () => fill);

const summary: CostSummaryResponse & { budgets: BudgetStatus[] } = {
  from: '2026-10-07T00:00:00.000Z',
  to: '2026-11-06T00:00:00.000Z',
  days: 30,
  interactive: {
    totalUsd: 90,
    eventCount: 300,
    failedCount: 2,
    bySurface: [
      { surface: 'inspector', usd: 60, count: 200 },
      { surface: 'workbench', usd: 30, count: 100 },
    ],
    byModel: [{ model: 'claude-sonnet-5-5', usd: 90, count: 300 }],
    byAgent: [{ agentSlug: 'catalog-agent', usd: 20, count: 40 }],
    tokens: { input: 1_000_000, output: 200_000, cacheRead: 3_000_000, cacheWrite: 10_000 },
    dailyUsd: days30(3),
  },
  harvest: {
    totalUsd: 60,
    eventCount: 12,
    llmUsd: 45,
    infraUsd: 15,
    byKind: [{ jobKind: 'describe', usd: 60, count: 12 }],
    dailyUsd: days30(2),
  },
  previous: { from: '2026-09-07T00:00:00.000Z', interactiveUsd: 60, harvestUsd: 30, interactiveCount: 200, harvestCount: 10 },
  byUser: [
    { userId: 'u1', email: 'ana@example.test', name: 'Ana Ruiz', interactiveUsd: 50, harvestUsd: 40, interactiveCount: 150, harvestCount: 8, lastAt: '2026-11-05T10:00:00.000Z' },
    { userId: 'u2', email: 'ben@example.test', name: 'Ben Ito', interactiveUsd: 40, harvestUsd: 20, interactiveCount: 150, harvestCount: 4, lastAt: '2026-11-04T10:00:00.000Z' },
  ],
  budgets: [],
};

const policies: BudgetPolicy[] = [
  { id: 'p1', scope: 'org:o1:interactive', orgId: 'o1', amountUsd: 100, period: 'monthly', mode: 'soft', alertPct: 80, alertEmail: 'ops@example.test' },
  { id: 'p2', scope: 'org:o1:harvest', orgId: 'o1', amountUsd: 2500, period: 'monthly', mode: 'soft', alertPct: 80, alertEmail: null },
  { id: 'p3', scope: 'role:member:interactive', orgId: null, amountUsd: 75, period: 'monthly', mode: 'soft', alertPct: 80, alertEmail: null },
];
const statuses: BudgetStatus[] = [
  { scope: 'org:o1:interactive', label: 'Org — interactive AI', amountUsd: 100, spentUsd: 92, period: 'monthly', mode: 'soft', alertPct: 80, pctUsed: 92, alert: true, exceeded: false },
  { scope: 'org:o1:harvest', label: 'Org — harvest', amountUsd: 2500, spentUsd: 60, period: 'monthly', mode: 'soft', alertPct: 80, pctUsed: 2.4, alert: false, exceeded: false },
  {
    scope: 'role:member:interactive', label: 'Role member — interactive', amountUsd: 75, spentUsd: 64, period: 'monthly', mode: 'soft', alertPct: 80,
    pctUsed: 53, alert: false, exceeded: false,
    group: { totalUsd: 64, people: 2, topUserId: 'u1', topUserUsd: 40, overCount: 0, alertCount: 0 },
  },
];

const event: SpendEventRow = {
  id: 'e1', occurredAt: '2026-11-05T09:00:00.000Z', bucket: 'interactive', surface: 'inspector', action: 'turn', usd: 0.42,
  userId: 'u1', userEmail: 'ana@example.test', model: 'claude-sonnet-5-5', jobKind: null, agentSlug: null, sessionId: 's-123',
  jobId: null, status: 'success', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, meta: {},
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/admin/cost/summary')) return json(summary);
    if (url === '/api/admin/cost/budgets' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as BudgetPolicy;
      return json({ policies: policies.map((p) => (p.id === body.id ? { ...p, ...body } : p)), statuses });
    }
    if (url === '/api/admin/cost/budgets') return json({ policies, statuses });
    if (url === '/api/users') return json({ users: [{ id: 'u1', name: 'Ana Ruiz', email: 'ana@example.test' }] });
    if (url.startsWith('/api/admin/cost/events')) return json({ total: 1, totalUsd: 0.42, events: [event] });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => vi.unstubAllGlobals());

function renderPage(entry = '/agent-staging/cost') {
  const router = createMemoryRouter([{ path: '/agent-staging/cost', element: <CostMonitorPage /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
}

const eventUrls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/admin/cost/events'));

describe('Cost monitor', () => {
  it('shows totals with period-over-period change and flags budgets at their alert threshold', async () => {
    renderPage();
    expect(await screen.findByText('$150.00')).toBeTruthy(); // 90 + 60
    expect(screen.getByText('+67%')).toBeTruthy(); // total 150 vs 90
    expect(screen.getByText('+50%')).toBeTruthy(); // interactive 90 vs 60
    expect(screen.getByText('+100%')).toBeTruthy(); // harvest 60 vs 30
    expect(screen.getByText(/1 budget needs attention/)).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /Budgets/ })).getByText('1')).toBeTruthy();
  });

  it('drills from a cost driver into a filtered ledger', async () => {
    const router = renderPage();
    const drivers = await screen.findByRole('heading', { name: 'Top cost drivers' });
    const card = drivers.closest('section')!;
    fireEvent.click(within(card).getByRole('button', { name: /inspector/ }));
    await waitFor(() => expect(router.state.location.search).toContain('tab=ledger'));
    expect(await screen.findByRole('button', { name: 'Remove filter Surface: inspector' })).toBeTruthy();
    await waitFor(() => expect(eventUrls().some((u) => u.includes('surface=inspector') && u.includes('bucket=interactive'))).toBe(true));
  });

  it('opens a person drawer from the People tab with their recent events', async () => {
    renderPage('/agent-staging/cost?tab=people');
    fireEvent.click(await screen.findByText('Ana Ruiz'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Ana Ruiz' })).toBeTruthy();
    await waitFor(() => expect(eventUrls().some((u) => u.includes('userId=u1'))).toBe(true));
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a role cap as a combined total with the highest spender', async () => {
    renderPage('/agent-staging/cost?tab=budgets');
    const title = await screen.findByRole('heading', { name: 'Member role' });
    const card = title.closest('article')!;
    expect(within(card).getByText('$64.00')).toBeTruthy();
    expect(within(card).getByText(/combined this month/)).toBeTruthy();
    expect(within(card).getByText('2 people')).toBeTruthy();
    expect(within(card).getByText('Ana Ruiz')).toBeTruthy();
    expect(within(card).getByText(/\$40\.00 of \$75\.00/)).toBeTruthy();
  });

  it('shows budgets without edit controls to people who can only view', async () => {
    costLevel.value = 'view';
    try {
      renderPage('/agent-staging/cost?tab=budgets');
      await screen.findByRole('heading', { name: 'Member role' });
      expect(screen.queryByRole('button', { name: 'Edit Interactive AI' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Add cap/ })).toBeNull();
    } finally {
      costLevel.value = 'manage';
    }
  });

  it('creates a combined cap for a role', async () => {
    renderPage('/agent-staging/cost?tab=budgets');
    fireEvent.click(await screen.findByRole('button', { name: /Add cap/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'A role combined' }));
    expect(screen.getByText(/One cap shared by everyone with this role/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cap (USD)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create cap' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put![1] as RequestInit).body))).toMatchObject({ scope: 'role-total:member:interactive', amountUsd: 1000 });
    });
  });

  it('edits a budget and keeps its stored alert email', async () => {
    renderPage('/agent-staging/cost?tab=budgets');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Interactive AI' }));
    const cap = screen.getByLabelText('Cap (USD)');
    fireEvent.change(cap, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      const body = JSON.parse(String((put![1] as RequestInit).body));
      expect(body).toMatchObject({ id: 'p1', scope: 'org:o1:interactive', amountUsd: 150, alertEmail: 'ops@example.test' });
    });
  });
});
