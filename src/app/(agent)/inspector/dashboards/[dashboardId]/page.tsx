import { DashboardViewer } from '@/components/inspector/dashboard-viewer/DashboardViewer';

export const dynamic = 'force-dynamic';

interface ViewerPageProps {
  params: Promise<{ dashboardId: string }>;
}

/**
 * Read-only dashboard viewer at /inspector/dashboards/[dashboardId].
 * The edit surface lives at the /builder sub-route. Mirrors builder/page.tsx:
 * a thin server component that delegates to a client component which loads the
 * dashboard, resolves the caller's role, and fetches live widget data (auth is
 * enforced by the underlying API routes).
 */
export default async function DashboardViewerPage({ params }: ViewerPageProps) {
  const { dashboardId } = await params;
  return <DashboardViewer dashboardId={dashboardId} />;
}
