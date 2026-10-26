'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from '@/lib/navigation/link';
import { useSearchParams } from '@/lib/navigation';
import { ExternalLink, ArrowLeft, Bot } from 'lucide-react';
import type { AgentCatalogEntry } from '@/types/catalog';

const CATALOG_AGENT_HINT_KEY = 'aloft.catalogAgent.slug';

export default function AgentStagingTryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[320px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[color:var(--brand-a)]" />
        </div>
      }
    >
      <AgentStagingTryContent />
    </Suspense>
  );
}

function AgentStagingTryContent() {
  const searchParams = useSearchParams();
  const agentSlug = searchParams.get('agent')?.trim() ?? '';
  const [agent, setAgent] = useState<AgentCatalogEntry | null>(null);
  const [loading, setLoading] = useState(Boolean(agentSlug));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSlug) {
      setLoading(false);
      setError('No agent specified. Open an agent from the catalog and use “Try in Inspector”.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/catalog/agents?slug=${encodeURIComponent(agentSlug)}`);
        if (res.status === 404) {
          if (!cancelled) setError(`Agent "${agentSlug}" was not found in the catalog.`);
          return;
        }
        if (!res.ok) throw new Error('Failed to load agent');
        const data = await res.json();
        const item = data.item as AgentCatalogEntry | undefined;
        if (!item) {
          if (!cancelled) setError(`Agent "${agentSlug}" was not found.`);
          return;
        }
        if (!cancelled) setAgent(item);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load agent');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentSlug]);

  const systemPrompt =
    agent?.config && typeof agent.config === 'object' && 'systemPrompt' in agent.config
      ? String((agent.config as Record<string, unknown>).systemPrompt ?? '')
      : '';

  const openInspector = () => {
    if (agentSlug) {
      try {
        sessionStorage.setItem(CATALOG_AGENT_HINT_KEY, agentSlug);
      } catch {
        /* ignore */
      }
    }
    window.location.href = '/inspector';
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[color:var(--brand-a)]" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="mb-4 text-sm text-red-500">{error ?? 'Agent not found'}</p>
        <Link href="/docs/agents" className="text-sm text-[color:var(--brand-a-ink)] hover:underline">
          Back to agent catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-2 text-xs text-[var(--ink-3)]">
        <Link href="/docs/agents" className="hover:text-[color:var(--brand-a-ink)]">Agents</Link>
        <span>/</span>
        <Link href={`/docs/agents/${agent.slug}`} className="hover:text-[color:var(--brand-a-ink)]">{agent.name}</Link>
        <span>/</span>
        <span className="text-[var(--ink-2)]">Try</span>
      </nav>

      <div className="mb-6 flex items-start gap-3">
        <Bot className="mt-1 h-6 w-6 shrink-0 text-[color:var(--brand-a-ink)]" />
        <div>
          <h1 className="text-xl font-semibold text-[var(--ink-1)]">{agent.name}</h1>
          <p className="mt-1 text-sm text-[var(--ink-3)]">
            Staging preview — run this agent&apos;s mission in Inspector (data &amp; Databricks chat).
          </p>
        </div>
      </div>

      {agent.description && (
        <p className="mb-6 text-sm leading-relaxed text-[var(--ink-2)]">{agent.description}</p>
      )}

      {systemPrompt && (
        <section className="mb-8 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
            Mission (from catalog)
          </h2>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-2)] font-mono">
            {systemPrompt.length > 1200 ? `${systemPrompt.slice(0, 1200)}…` : systemPrompt}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={openInspector}
          className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--brand-a)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[color:var(--brand-a-2)]"
        >
          <ExternalLink className="h-4 w-4" />
          Open in Inspector
        </button>
        <Link
          href={`/docs/agents/${agent.slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--ink-3)] hover:text-[var(--ink-1)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Agent docs
        </Link>
      </div>

      <p className="mt-8 text-xs text-[var(--ink-3)] leading-relaxed">
        A dedicated runtime chat per catalog agent is not wired yet. Inspector is the supported way to
        exercise domain behavior today; your mission text is saved locally so we can pre-fill prompts in a
        future release.
      </p>
    </div>
  );
}
