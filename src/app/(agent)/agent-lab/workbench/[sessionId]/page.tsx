import WorkbenchShell from '@/components/workbench/WorkbenchShell';

export const dynamic = 'force-dynamic';

interface WorkbenchSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function WorkbenchSessionPage({ params }: WorkbenchSessionPageProps) {
  const { sessionId } = await params;
  return <WorkbenchShell sessionId={sessionId} />;
}
