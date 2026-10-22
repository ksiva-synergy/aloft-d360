import TeachShell from '@/components/teach/TeachShell';

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
