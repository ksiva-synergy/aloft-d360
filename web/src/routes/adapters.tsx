/**
 * Route adapters: the few pages whose Next.js versions were async server components. Each one is the
 * browser equivalent of the original `page.tsx` — same components, same props — with the route param read
 * via `useParams()` (instead of `await params`) or the data loaded from a JSON API (instead of Prisma).
 *
 * Heavy components are `React.lazy` so visiting one route does not download the others.
 */
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { agentsWorkbenchSessionHref, AGENTS_WORKBENCH_HREF } from '@/lib/navigation/agents-routes';
import type { DashboardSummary } from '@/lib/dashboard/summary';
import { useJson } from '../lib/useJson';

const RunDetailPage = lazy(() => import('@/components/agent-ops/RunDetailPage'));
const TeachShell = lazy(() => import('@/components/teach/TeachShell'));
const WorkbenchShell = lazy(() => import('@/components/workbench/WorkbenchShell'));
const InspectorShell = lazy(() => import('@/components/inspector/InspectorShell'));
const JobRunPage = lazy(() => import('@/components/estate/JobRunPage'));
const DashboardViewer = lazy(() =>
  import('@/components/inspector/dashboard-viewer/DashboardViewer').then((m) => ({ default: m.DashboardViewer })),
);
const DashboardBuilder = lazy(() =>
  import('@/components/inspector/dashboard-builder/DashboardBuilder').then((m) => ({ default: m.DashboardBuilder })),
);
const DashboardView = lazy(() => import('@/components/dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));
const FoerOpsDashboard = lazy(() =>
  import('@/components/agent-lab/memory/FoerOpsDashboard').then((m) => ({ default: m.FoerOpsDashboard })),
);

const MONO = { fontFamily: 'var(--font-mono)' } as const;

export function PageMessage({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-size-body text-[var(--ink-3)]" style={MONO}>
      <span>{text}</span>
      {children}
    </div>
  );
}

function Loading() {
  return <PageMessage text="Loading…" />;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

export function NotFoundPage() {
  return (
    <PageMessage text="Page not found">
      <Link to="/dashboard" className="text-[var(--brand-a-ink)] underline">
        Back to dashboard
      </Link>
    </PageMessage>
  );
}

export const RedirectTo = ({ to }: { to: string }) => <Navigate to={to} replace />;

/** Legacy estate URLs used `objects` (plural); the canonical route is `object/:id`. */
export function EstateObjectLegacyRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/agent-lab/estate/object/${encodeURIComponent(id)}`} replace />;
}

/** Legacy workbench URLs live under Agents now. */
export function WorkbenchLegacyRedirect() {
  const { sessionId } = useParams();
  const to = sessionId ? agentsWorkbenchSessionHref(sessionId) : AGENTS_WORKBENCH_HREF;
  return <Navigate to={to} replace />;
}

/* ── `await params` pages ─────────────────────────────────────────────────────────── */

export function RunSessionRoute() {
  const { sessionId = '' } = useParams();
  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      <Lazy>
        <RunDetailPage sessionId={sessionId} />
      </Lazy>
    </div>
  );
}

export function TeachSessionRoute() {
  const { sessionId = '' } = useParams();
  return (
    <Lazy>
      <TeachShell sessionId={sessionId} />
    </Lazy>
  );
}

export function WorkbenchSessionRoute() {
  const { sessionId = '' } = useParams();
  return (
    <Lazy>
      <WorkbenchShell sessionId={sessionId} />
    </Lazy>
  );
}

export function InspectorSessionRoute() {
  const { sessionId = '' } = useParams();
  return (
    <Lazy>
      <InspectorShell sessionId={sessionId} />
    </Lazy>
  );
}

export function DashboardViewerRoute() {
  const { dashboardId = '' } = useParams();
  return (
    <Lazy>
      <DashboardViewer dashboardId={dashboardId} />
    </Lazy>
  );
}

export function DashboardBuilderRoute() {
  const { dashboardId = '' } = useParams();
  return (
    <Lazy>
      <DashboardBuilder dashboardId={dashboardId} />
    </Lazy>
  );
}

/* ── pages that used to read the database on the server ───────────────────────────── */

interface DashboardPayload {
  summary: DashboardSummary;
  displayName: string;
  roleLabel: string;
  canReadUsers: boolean;
}

/** Was `(agent)/dashboard/page.tsx` (Prisma + RBAC on the server) → `GET /api/dashboard/summary`. */
export function DashboardRoute() {
  const state = useJson<DashboardPayload>('/api/dashboard/summary');
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.httpStatus === 401) return <Navigate to="/login" replace />;
    return <PageMessage text="Could not load the dashboard. Reload to try again." />;
  }
  return (
    <Lazy>
      <DashboardView {...state.data} />
    </Lazy>
  );
}

/** Was `estate/jobs/[id]/page.tsx` (session + getJob + notFound) → `GET /api/agent-lab/context/jobs/:id`. */
export function JobDetailRoute() {
  const { id = '' } = useParams();
  const state = useJson<{ data: unknown }>(id ? `/api/agent-lab/context/jobs/${encodeURIComponent(id)}` : null);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.httpStatus === 401) return <Navigate to="/login" replace />;
    if (state.httpStatus === 404 || state.httpStatus === 400) return <NotFoundPage />;
    return <PageMessage text="Could not load this job. Reload to try again." />;
  }
  return (
    <Lazy>
      {/* JobRunPage takes the prisma row; JSON turns Dates into ISO strings, which it wraps in `new Date()` */}
      <JobRunPage job={state.data.data as never} />
    </Lazy>
  );
}

/** Was `memory/ops/page.tsx` (session + getCurrentTopicMap) → `GET /api/agent-lab/memory/topic-map`. */
export function MemoryOpsRoute() {
  const state = useJson<{ topicMap: Record<string, { topicKey: string; topicName: string; rank: number }> }>(
    '/api/agent-lab/memory/topic-map',
  );
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.httpStatus === 401) return <Navigate to="/login" replace />;
    return <PageMessage text="Could not load memory operations. Reload to try again." />;
  }
  return (
    <div className="h-full overflow-y-auto">
      <Lazy>
        <FoerOpsDashboard topicMap={state.data.topicMap} />
      </Lazy>
    </div>
  );
}
