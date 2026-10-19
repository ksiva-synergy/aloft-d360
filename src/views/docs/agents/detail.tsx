'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AgentDocPage } from '@/components/docs';
import type { AgentCatalogEntry } from '@/types/catalog';

export default function AgentDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [agent, setAgent] = useState<AgentCatalogEntry | null>(null);
  const [relatedAgents, setRelatedAgents] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(`/api/catalog/agents?slug=${encodeURIComponent(slug)}`);
        if (res.status === 404) {
          setError(`Agent "${slug}" not found`);
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch agent');
        const data = await res.json();
        const found = data.item as AgentCatalogEntry | undefined;
        if (!found) {
          setError(`Agent "${slug}" not found`);
          return;
        }

        setAgent(found);

        const listRes = await fetch('/api/catalog/agents?limit=200');
        const listData = listRes.ok ? await listRes.json() : { items: [] };
        const items: AgentCatalogEntry[] = listData.items || [];
        const related = items
          .filter(a => a.id !== found.id)
          .filter(a =>
            a.type === found.type ||
            (found.tags || []).some(tag => (a.tags || []).includes(tag))
          )
          .slice(0, 4);
        setRelatedAgents(related);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load agent');
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[color:var(--brand-a)]" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-sm text-red-500 mb-2">{error || 'Agent not found'}</p>
        <Link href="/docs/agents" className="text-xs text-[color:var(--brand-a-ink)] hover:underline">
          Back to Agents
        </Link>
      </div>
    );
  }

  return <AgentDocPage agent={agent} relatedAgents={relatedAgents} />;
}
