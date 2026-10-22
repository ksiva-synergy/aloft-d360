'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bot, MessageCircle, Pencil, Plus, Search } from 'lucide-react';

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'A') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

export default function SavedAgentsPage() {
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.description, agent.agentClass, agent.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [agents, query]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink-1)]">Agents</h1>
          <p className="mt-1 text-sm text-[var(--ink-3)]">
            {loading ? 'Loading saved agents…' : `${agents.length} saved from the Workbench`}
          </p>
        </div>
        <Link
          href="/agent-lab/workbench"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--brand-a)] px-4 text-sm font-semibold text-white"
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
          className="h-full w-full bg-transparent text-sm text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
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
        <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>
      )}

      {!loading && !error && agents.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-[var(--line-1)] px-6 py-16 text-center">
          <Bot className="mx-auto h-8 w-8 text-[var(--ink-3)]" />
          <p className="mt-3 text-sm font-medium text-[var(--ink-1)]">No agents yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--ink-3)]">
            Create one in the Workbench. After you commission it, it shows up here and you can chat with it.
          </p>
        </div>
      )}

      {!loading && !error && agents.length > 0 && visible.length === 0 && (
        <p className="mt-8 text-sm text-[var(--ink-3)]">No agents match “{query.trim()}”.</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((agent) => (
            <li key={agent.id}>
              <article className="flex h-full flex-col rounded-2xl border border-[var(--line-1)] bg-[var(--surface-1)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--brand-a)_55%,var(--line-1))]">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-a-soft)] text-sm font-semibold text-[var(--brand-a-ink)]">
                    {initials(agent.name)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold text-[var(--ink-1)]">{agent.name}</h2>
                    <p className="mt-0.5 truncate text-xs text-[var(--ink-3)]">
                      {[agent.agentClass, agent.status].filter(Boolean).join(' · ') || 'Agent'}
                      {agent.updatedAt ? ` · ${when(agent.updatedAt)}` : ''}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-[var(--ink-2)]">
                  {agent.description || 'No description yet.'}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={agent.useUrl}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--brand-a)] px-3 text-[13px] font-semibold text-white"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Chat
                  </Link>
                  <Link
                    href={agent.catalogUrl}
                    className="inline-flex h-8 items-center rounded-full px-2.5 text-[13px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                  >
                    View
                  </Link>
                  {agent.editUrl && (
                    <Link
                      href={agent.editUrl}
                      className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Link>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
