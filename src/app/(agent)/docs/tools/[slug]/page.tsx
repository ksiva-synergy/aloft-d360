'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ToolDocPage } from '@/components/docs';
import type { ToolCatalogEntry } from '@/types/catalog';

export default function ToolDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [tool, setTool] = useState<ToolCatalogEntry | null>(null);
  const [relatedTools, setRelatedTools] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTool() {
      try {
        const res = await fetch('/api/catalog/tools');
        if (!res.ok) throw new Error('Failed to fetch tools');
        const data = await res.json();
        const items: ToolCatalogEntry[] = data.items || data;

        const found = items.find(t => t.slug === slug || t.name === slug);
        if (!found) {
          setError(`Tool "${slug}" not found`);
          return;
        }

        setTool(found);

        const related = items
          .filter(t => t.id !== found.id)
          .filter(t =>
            t.type === found.type ||
            (found.tags || []).some(tag => (t.tags || []).includes(tag))
          )
          .slice(0, 4);
        setRelatedTools(related);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchTool();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    );
  }

  if (error || !tool) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <p className="text-sm text-red-500 mb-2">{error || 'Tool not found'}</p>
        <Link href="/docs/tools" className="text-xs text-indigo-600 hover:underline">
          Back to Tools
        </Link>
      </div>
    );
  }

  return <ToolDocPage tool={tool} relatedTools={relatedTools} />;
}
