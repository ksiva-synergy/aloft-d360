'use client';

import { cn } from '@/lib/utils';
import { agentInitials } from '@/lib/agents/pinned-agents-shared';

/** Initials badge for a pinned agent in the sidebar; initials keep similar agents apart where icons repeat. */
export function PinnedAgentBadge({ name, active, className }: { name: string; active: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-size-caption font-semibold leading-none tracking-wide transition-colors',
        active
          ? 'border-transparent bg-[var(--rail-accent)] text-white'
          : 'border-[var(--rail-line)] bg-[var(--rail-hover)] text-[var(--rail-ink-strong)]',
        className,
      )}
    >
      {agentInitials(name)}
    </span>
  );
}

/** True on the agent's chat page (and its sub-pages). */
export function isPinnedAgentActive(useUrl: string, pathname: string): boolean {
  return pathname === useUrl || pathname.startsWith(`${useUrl}/`);
}
