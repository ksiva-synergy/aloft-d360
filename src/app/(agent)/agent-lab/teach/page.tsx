import type { Metadata } from 'next';
import TeachShell from '@/components/teach/TeachShell';

export const metadata: Metadata = {
  title: 'Teach · Marcus Reflect',
  description: 'Teach Marcus — a learning-mode session that understands rather than does, extracting verified, curated knowledge and showing it live.',
};

/**
 * Teach Phase 4 — the always-available Teach page.
 *
 * A single immersive session surface: the Marcus (Reflect mode) conversation on
 * the left, the live "What Marcus is learning" rail on the right. Teach only
 * PRODUCES candidates; review / conflict-commit / promote-to-governed is Build.
 * The read-only candidate hand-off lives at /agent-lab/teach/digest.
 */
export default function TeachPage() {
  return <TeachShell />;
}
