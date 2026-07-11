import InspectorShell from '@/components/inspector/InspectorShell';

export const dynamic = 'force-dynamic';

interface InspectorSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function InspectorSessionPage({ params }: InspectorSessionPageProps) {
  const { sessionId } = await params;
  return <InspectorShell sessionId={sessionId} />;
}
