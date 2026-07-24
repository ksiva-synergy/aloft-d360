import type { Metadata } from 'next';
import TeachShell from '@/components/teach/TeachShell';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Teach · Marcus Reflect',
  description: 'A saved Teach session — the conversation and the live "What Marcus is learning" rail, restored.',
};

interface TeachSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * Teach retention (Track A) — the durable per-session route. Thin server component
 * that hands the sessionId to TeachShell, which hydrates the thread + rail through
 * the guarded (always-enforce) hydrate endpoint. Mirrors inspector/[sessionId].
 */
export default async function TeachSessionPage({ params }: TeachSessionPageProps) {
  const { sessionId } = await params;
  return <TeachShell sessionId={sessionId} />;
}
