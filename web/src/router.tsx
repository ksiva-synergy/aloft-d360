import { createBrowserRouter, Outlet } from 'react-router';
import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import { RootLayout, type RouteHandle } from './RootLayout';
import { FullPageMessage, RequireAuth } from './RequireAuth';
import { AgentLayout } from './AgentLayout';
import { RouteErrorBoundary } from './routes/RouteErrorBoundary';
import {
  DashboardBuilderRoute,
  DashboardRoute,
  DashboardViewerRoute,
  InspectorSessionRoute,
  JobDetailRoute,
  MemoryOpsRoute,
  NotFoundPage,
  RedirectTo,
  RunSessionRoute,
  TeachSessionRoute,
  WorkbenchSessionRoute,
} from './routes/adapters';

/**
 * Route table = the Next.js `src/app/**` tree, one entry per `page.tsx` (43 pages).
 *
 * Pages are imported from `src/app` in place (code-split per route). A page that was an async server component
 * is replaced by an adapter in ./routes/adapters. `export const metadata` titles are carried as `handle.title`.
 */
type PageModule = { default: ComponentType };
const page =
  (load: () => Promise<PageModule>): NonNullable<RouteObject['lazy']> =>
  async () => ({ Component: (await load()).default });

const title = (t: string): RouteHandle => ({ title: t });

const estateRoutes: RouteObject[] = [
  { index: true, lazy: page(() => import('@/views/agent-lab/estate/index')) },
  { path: 'catalog', lazy: page(() => import('@/views/agent-lab/estate/catalog')) },
  { path: 'entities', lazy: page(() => import('@/views/agent-lab/estate/entities')) },
  { path: 'jobs', lazy: page(() => import('@/views/agent-lab/estate/jobs')) },
  { path: 'jobs/:id', Component: JobDetailRoute },
  { path: 'lineage', lazy: page(() => import('@/views/agent-lab/estate/lineage')) },
  { path: 'mapper', lazy: page(() => import('@/views/agent-lab/estate/mapper')) },
  { path: 'object/:id', lazy: page(() => import('@/views/agent-lab/estate/object')) },
  { path: 'silo', lazy: page(() => import('@/views/agent-lab/estate/silo')) },
];

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    // Shown while the first lazy route chunk loads (also silences React Router's HydrateFallback warning).
    HydrateFallback: () => <FullPageMessage text="Loading…" />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <RedirectTo to="/dashboard" /> },
      { path: 'login', lazy: page(() => import('@/views/login')) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AgentLayout />,
            children: [
              {
                // A page error replaces only the page content; the sidebar and header stay usable.
                errorElement: <RouteErrorBoundary />,
                children: [
              { path: 'dashboard', Component: DashboardRoute, handle: title('Dashboard · ALOFT') },

              // ── Agent Lab ──────────────────────────────────────────────────────────
              { path: 'agent-lab/bandits', lazy: page(() => import('@/views/agent-lab/bandits')) },
              {
                path: 'agent-lab/estate',
                lazy: async () => {
                  const Layout = (await import('@/views/agent-lab/estate/EstateLayout')).default;
                  return { Component: () => <Layout><Outlet /></Layout> };
                },
                children: estateRoutes,
              },
              { path: 'agent-lab/history', lazy: page(() => import('@/views/agent-lab/history')) },
              {
                path: 'agent-lab/memory',
                lazy: page(() => import('@/views/agent-lab/memory/index')),
                handle: title('FOER — Agent Work-Memory · Aloft'),
              },
              {
                path: 'agent-lab/memory/contributions',
                lazy: page(() => import('@/views/agent-lab/memory/contributions')),
                handle: title('Memory Contributions · Aloft'),
              },
              { path: 'agent-lab/memory/ops', Component: MemoryOpsRoute, handle: title('FOER Ops — Memory Operations · Aloft') },
              { path: 'agent-lab/metrics', lazy: page(() => import('@/views/agent-lab/metrics')) },
              { path: 'agent-lab/ops/evals', lazy: page(() => import('@/views/agent-lab/ops/evals')) },
              { path: 'agent-lab/ops/prompts', lazy: page(() => import('@/views/agent-lab/ops/prompts')) },
              { path: 'agent-lab/runs', element: <RedirectTo to="/agent-lab/history" /> },
              { path: 'agent-lab/runs/:sessionId', Component: RunSessionRoute },
              {
                path: 'agent-lab/teach',
                lazy: page(() => import('@/views/agent-lab/teach/index')),
                handle: title('Teach · Captain Track Sparrow Reflect'),
              },
              {
                path: 'agent-lab/teach/digest',
                lazy: page(() => import('@/views/agent-lab/teach/digest')),
                handle: title('Teach · Candidate hand-off'),
              },
              { path: 'agent-lab/teach/:sessionId', Component: TeachSessionRoute, handle: title('Teach · Captain Track Sparrow Reflect') },
              { path: 'agent-lab/workbench', lazy: page(() => import('@/views/agent-lab/workbench')) },
              { path: 'agent-lab/workbench/:sessionId', Component: WorkbenchSessionRoute },

              // ── Govern (agent-staging) ─────────────────────────────────────────────
              { path: 'agent-staging', element: <RedirectTo to="/docs/agents" /> },
              { path: 'agent-staging/audit', lazy: page(() => import('@/views/agent-staging/audit')) },
              { path: 'agent-staging/policies', lazy: page(() => import('@/views/agent-staging/policies')) },
              { path: 'agent-staging/try', lazy: page(() => import('@/views/agent-staging/try')) },
              { path: 'agent-staging/users', lazy: page(() => import('@/views/agent-staging/users')) },

              // ── Docs ───────────────────────────────────────────────────────────────
              { path: 'docs', lazy: page(() => import('@/views/docs/index')) },
              { path: 'docs/agents', lazy: page(() => import('@/views/docs/agents')) },
              { path: 'docs/agents/:slug', lazy: page(() => import('@/views/docs/agents/detail')) },
              { path: 'docs/tools', lazy: page(() => import('@/views/docs/tools')) },
              { path: 'docs/tools/:slug', lazy: page(() => import('@/views/docs/tools/detail')) },

              // ── Inspector ──────────────────────────────────────────────────────────
              { path: 'inspector', lazy: page(() => import('@/views/inspector/index')) },
              { path: 'inspector/dashboards', lazy: page(() => import('@/views/inspector/dashboards')) },
              { path: 'inspector/dashboards/:dashboardId', Component: DashboardViewerRoute },
              { path: 'inspector/dashboards/:dashboardId/builder', Component: DashboardBuilderRoute },
              { path: 'inspector/:sessionId', Component: InspectorSessionRoute },

              { path: 'performance-lab', lazy: page(() => import('@/views/performance-lab')) },
              { path: '*', Component: NotFoundPage },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
