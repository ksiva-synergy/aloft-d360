import { DashboardBuilder } from '@/components/inspector/dashboard-builder/DashboardBuilder';

export const dynamic = 'force-dynamic';

interface BuilderPageProps {
  params: Promise<{ dashboardId: string }>;
}

export default async function DashboardBuilderPage({ params }: BuilderPageProps) {
  const { dashboardId } = await params;
  return <DashboardBuilder dashboardId={dashboardId} />;
}
