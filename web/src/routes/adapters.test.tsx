import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardRoute, JobDetailRoute, MemoryOpsRoute, NotFoundPage, RedirectTo, RunSessionRoute } from './adapters';
import { useJson } from '../lib/useJson';

type Stub = { status: number; body?: unknown };
let calls: string[] = [];

function stubFetch(map: Record<string, Stub>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      const hit = Object.entries(map).find(([k]) => url.startsWith(k));
      const { status, body } = hit?.[1] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function mount(path: string, routePath: string, Component: React.ComponentType) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <div>LOGIN PAGE</div> },
      { path: routePath, Component },
      { path: '*', Component: NotFoundPage },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => stubFetch({}));
afterEach(() => vi.unstubAllGlobals());

describe('JobDetailRoute (was estate/jobs/[id]/page.tsx: session + getJob + notFound)', () => {
  it('asks the existing jobs API for the id in the URL', async () => {
    stubFetch({ '/api/agent-lab/context/jobs/job%2F1': { status: 404 } });
    mount('/jobs/job%2F1', '/jobs/:id', JobDetailRoute);
    await waitFor(() => expect(calls[0]).toBe('/api/agent-lab/context/jobs/job%2F1'));
  });

  it('shows the not-found page on 404 (what notFound() did)', async () => {
    stubFetch({ '/api/agent-lab/context/jobs/': { status: 404 } });
    mount('/jobs/missing', '/jobs/:id', JobDetailRoute);
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });

  it('sends a signed-out user to /login on 401', async () => {
    stubFetch({ '/api/agent-lab/context/jobs/': { status: 401 } });
    const router = mount('/jobs/j1', '/jobs/:id', JobDetailRoute);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('shows a retry message on a server error instead of crashing', async () => {
    stubFetch({ '/api/agent-lab/context/jobs/': { status: 500 } });
    mount('/jobs/j1', '/jobs/:id', JobDetailRoute);
    expect(await screen.findByText(/Could not load this job/)).toBeTruthy();
  });
});

describe('MemoryOpsRoute (was memory/ops/page.tsx: session + getCurrentTopicMap)', () => {
  it('calls the new topic-map API', async () => {
    stubFetch({ '/api/agent-lab/memory/topic-map': { status: 500 } });
    mount('/ops', '/ops', MemoryOpsRoute);
    await waitFor(() => expect(calls).toContain('/api/agent-lab/memory/topic-map'));
  });

  it('401 -> /login, 500 -> message', async () => {
    stubFetch({ '/api/agent-lab/memory/topic-map': { status: 401 } });
    const router = mount('/ops', '/ops', MemoryOpsRoute);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('shows a message on a server error', async () => {
    stubFetch({ '/api/agent-lab/memory/topic-map': { status: 500 } });
    mount('/ops', '/ops', MemoryOpsRoute);
    expect(await screen.findByText(/Could not load memory operations/)).toBeTruthy();
  });
});

describe('DashboardRoute (was dashboard/page.tsx: Prisma + RBAC on the server)', () => {
  it('calls the new summary API', async () => {
    stubFetch({ '/api/dashboard/summary': { status: 500 } });
    mount('/dashboard', '/dashboard', DashboardRoute);
    await waitFor(() => expect(calls).toContain('/api/dashboard/summary'));
  });

  it('401 -> /login', async () => {
    stubFetch({ '/api/dashboard/summary': { status: 401 } });
    const router = mount('/dashboard', '/dashboard', DashboardRoute);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('shows a message on a server error', async () => {
    stubFetch({ '/api/dashboard/summary': { status: 500 } });
    mount('/dashboard', '/dashboard', DashboardRoute);
    expect(await screen.findByText(/Could not load the dashboard/)).toBeTruthy();
  });
});

describe('param adapters and helpers', () => {
  it('RunSessionRoute reads :sessionId and renders the run page (which reports an unknown session)', async () => {
    stubFetch({ '/api/agent-lab/runs/abc-123': { status: 404 } });
    mount('/runs/abc-123', '/runs/:sessionId', RunSessionRoute);
    // The run page is a large lazy chunk; give Vitest time to transform it.
    await waitFor(() => expect(calls).toContain('/api/agent-lab/runs/abc-123'), { timeout: 45_000 });
    expect(await screen.findByText('Session not found or access denied.', {}, { timeout: 15_000 })).toBeTruthy();
  }, 90_000);

  it('RedirectTo replaces the current entry', async () => {
    const router = createMemoryRouter(
      [
        { path: '/old', element: <RedirectTo to="/new" /> },
        { path: '/new', element: <div>NEW</div> },
      ],
      { initialEntries: ['/old'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText('NEW')).toBeTruthy();
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('useJson aborts the request when the component unmounts', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise(() => {});
    }));
    function C() {
      useJson('/x');
      return null;
    }
    const { unmount } = render(<C />);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });
});
