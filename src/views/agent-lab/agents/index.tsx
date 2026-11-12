'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from '@/lib/navigation/link';
import { AGENTS_WORKBENCH_HREF } from '@/lib/navigation/agents-routes';
import { Bot, Eye, MessageCircle, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { forgetPinnedAgent, usePinnedAgents } from '@/lib/agents/usePinnedAgents';
import { MAX_PINNED_AGENTS } from '@/lib/agents/pinned-agents-shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AgentAvatar } from '@/components/agent-lab/AgentAvatar';
import { DeleteAgentDialog } from '@/components/agent-lab/DeleteAgentDialog';

type SavedAgent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  agentClass: string | null;
  updatedAt: string | null;
  catalogUrl: string;
  useUrl: string;
  editUrl: string | null;
};

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SavedAgentsPage() {
  const { data: session } = useSession();
  const isPlatformAdmin = (session?.user as { role?: string } | undefined)?.role === 'platform_admin';
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [agentToDelete, setAgentToDelete] = useState<SavedAgent | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent-lab/agents');
        const data = (await res.json().catch(() => ({}))) as { agents?: SavedAgent[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Could not load agents');
        if (!cancelled) setAgents(data.agents ?? []);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load agents');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const remove = async (agent: SavedAgent) => {
    setDeleting(agent.id);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/agents/${agent.id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not delete this agent');
      setAgents((prev) => prev.filter((row) => row.id !== agent.id));
      forgetPinnedAgent(agent.id);
      setAgentToDelete(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete this agent');
    } finally {
      setDeleting(null);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.description, agent.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [agents, query]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-size-kpi-lg font-semibold tracking-tight text-[var(--ink-1)]">Agents</h1>
          <p className="mt-1 text-size-body text-[var(--ink-3)]">
            {loading ? 'Loading saved agents…' : `${agents.length} saved from the Workbench`}
          </p>
        </div>
        <Link
          href={AGENTS_WORKBENCH_HREF}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--brand-a)] px-4 text-size-body font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New agent
        </Link>
      </div>

      <label className="mt-6 flex h-11 items-center gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--surface-1)] px-3">
        <Search className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents"
          className="h-full w-full bg-transparent text-size-body text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
        />
      </label>

      {loading && (
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)]" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-size-body text-red-500">{error}</p>
      )}

      {!loading && !error && agents.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-[var(--line-1)] px-6 py-16 text-center">
          <Bot className="mx-auto h-8 w-8 text-[var(--ink-3)]" />
          <p className="mt-3 text-size-body font-medium text-[var(--ink-1)]">No agents yet</p>
          <p className="mx-auto mt-1 max-w-sm text-size-body text-[var(--ink-3)]">
            Create one in the Workbench. After you commission it, it shows up here and you can chat with it.
          </p>
        </div>
      )}

      {!loading && !error && agents.length > 0 && visible.length === 0 && (
        <p className="mt-8 text-size-body text-[var(--ink-3)]">No agents match “{query.trim()}”.</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((agent) => (
            <li key={agent.id}>
              <AgentCard
                agent={agent}
                canDelete={isPlatformAdmin}
                onDelete={() => setAgentToDelete(agent)}
              />
            </li>
          ))}
        </ul>
      )}

      <DeleteAgentDialog
        open={agentToDelete !== null}
        name={agentToDelete?.name ?? ''}
        description={agentToDelete?.description}
        busy={agentToDelete !== null && deleting === agentToDelete.id}
        onClose={() => {
          if (deleting) return;
          setAgentToDelete(null);
        }}
        onConfirm={() => {
          if (agentToDelete) void remove(agentToDelete);
        }}
      />
    </div>
  );
}

/** Original card layout; Chat is the only inline action, Pin / View / Edit / Delete live in a ⋯ menu. */
function AgentCard({ agent, canDelete, onDelete }: { agent: SavedAgent; canDelete: boolean; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const { isPinned, full, setPinned } = usePinnedAgents();
  const pinned = isPinned(agent.id);
  const canPin = pinned || !full;
  const status = agent.status?.trim();
  const updated = when(agent.updatedAt);

  const togglePin = async () => {
    setPinError(null);
    const err = await setPinned(
      { id: agent.id, name: agent.name, slug: agent.slug, description: agent.description, useUrl: agent.useUrl },
      !pinned,
    );
    if (err) setPinError(err);
    else setMenuOpen(false);
  };
  const itemClass =
    'flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-size-ui font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:bg-[var(--surface-2)] focus-visible:outline-none';

  return (
    <article className="relative flex h-full flex-col rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--brand-a)_55%,var(--line-1))]">
      <div className="flex items-start gap-3 pr-8">
        <AgentAvatar name={agent.name} hint={agent.description ?? ''} size="md" />
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[length:var(--type-body-size)] font-semibold text-[var(--ink-1)]">
            <span className="truncate">{agent.name}</span>
            {pinned && (
              <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--brand-a)]" aria-label="Pinned to sidebar" />
            )}
          </h2>
          <p className="mt-0.5 truncate text-size-ui text-[var(--ink-3)]">
            {status || 'Agent'}
            {updated ? ` · ${updated}` : ''}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-size-body leading-relaxed text-[var(--ink-2)]">
        {agent.description || 'No description yet.'}
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Link
          href={agent.useUrl}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--brand-a)] px-3 text-[length:var(--type-ui-regular-size)] font-semibold text-white"
        >
          <MessageCircle className="h-3.5 w-3.5" /> Chat
        </Link>
      </div>

      <div className="absolute right-3 top-3">
        <Popover
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setPinError(null);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${agent.name}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[state=open]:bg-[var(--surface-2)] data-[state=open]:text-[var(--ink-1)]"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            <button
              type="button"
              onClick={() => void togglePin()}
              disabled={!canPin}
              title={canPin ? undefined : `You can pin up to ${MAX_PINNED_AGENTS} agents. Unpin one first.`}
              className={`${itemClass} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {pinned ? 'Unpin from sidebar' : canPin ? 'Pin to sidebar' : `Sidebar full (${MAX_PINNED_AGENTS}/${MAX_PINNED_AGENTS})`}
            </button>
            {pinError && <p className="px-2.5 pb-1 text-size-ui text-red-500">{pinError}</p>}
            <div className="my-1 border-t border-[var(--line-1)]" />
            <Link href={agent.catalogUrl} className={itemClass}>
              <Eye className="h-3.5 w-3.5" /> View details
            </Link>
            {agent.editUrl && (
              <Link href={agent.editUrl} className={itemClass}>
                <Pencil className="h-3.5 w-3.5" /> Edit in Workbench
              </Link>
            )}
            {canDelete && (
              <>
                <div className="my-1 border-t border-[var(--line-1)]" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className={`${itemClass} text-red-500 hover:text-red-500 focus-visible:text-red-500`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </article>
  );
}
