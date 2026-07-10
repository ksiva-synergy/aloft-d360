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
        const res = await fetch('/api/catalog/agents');
        if (!res.ok) throw new Error('Failed to fetch agents');
        const data = await res.json();
        const items: AgentCatalogEntry[] = data.items || data;

        const found = items.find(a => a.slug === slug || a.name === slug);
        if (!found) {
          setError(`Agent "${slug}" not found`);
          return;
        }

        setAgent(found);

        const related = items
          .filter(a => a.id !== found.id)
          .filter(a =>
            a.type === found.type ||
            (found.tags || []).some(tag => (a.tags || []).includes(tag))
          )
          .slice(0, 4);
        setRelatedAgents(related);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-sm text-red-500 mb-2">{error || 'Agent not found'}</p>
        <Link href="/docs/agents" className="text-xs text-indigo-600 hover:underline">
          Back to Agents
        </Link>
      </div>
    );
  }

  return <AgentDocPage agent={agent} relatedAgents={relatedAgents} />;
}
