'use client';

import { useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { usePinnedAgents } from '@/lib/agents/usePinnedAgents';
import { MAX_PINNED_AGENTS, type PinnedAgent } from '@/lib/agents/pinned-agents-shared';

/** "Pin" / "Pinned" toggle for one agent's sidebar shortcut (used in the agent chat header). */
export function PinAgentButton({ agent }: { agent: PinnedAgent }) {
  const { isPinned, full, loaded, setPinned } = usePinnedAgents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinned = isPinned(agent.id);
  const blocked = !pinned && full;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const err = await setPinned(agent, !pinned);
    setBusy(false);
    if (err) {
      setError(err);
      window.setTimeout(() => setError(null), 5000);
    }
  };

  const title = error
    ?? (blocked
      ? `You can pin up to ${MAX_PINNED_AGENTS} agents. Unpin one first.`
      : pinned ? 'Unpin from sidebar' : 'Pin to sidebar');

  return (
    <span className="relative inline-flex">
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!loaded || busy || blocked}
      aria-pressed={pinned}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-size-ui font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        error
          ? 'text-red-500 hover:bg-[var(--surface-2)]'
          : pinned
            ? 'text-[var(--brand-a)] hover:bg-[var(--surface-2)]'
            : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
      }`}
    >
      {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      {pinned ? 'Pinned' : 'Pin'}
    </button>
    {error && (
      <span
        role="alert"
        className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-red-500/30 bg-[var(--surface-1)] px-2.5 py-1.5 text-size-ui text-red-500 shadow-pop"
      >
        {error}
      </span>
    )}
    </span>
  );
}
