'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ObjectKnowledgePage } from '@/components/estate';

export default function EstateObjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<any>(null);

  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-secondary)';
  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';

  useEffect(() => {
    if (!id) return;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        setNotFound(false);

        const res = await fetch(`/api/agent-lab/context/objects/${id}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to load object data');
        }

        const json = await res.json();
        if (!json.data) {
          setNotFound(true);
        } else {
          setData(json.data);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [id]);

  if (loading) {
    // Beautiful full-page skeleton matching the layout structure
    return (
      <div className="p-6 overflow-y-auto h-full scrollbar-thin bg-[var(--background)] animate-pulse">
        <div className="max-w-[1180px] mx-auto space-y-6">
          {/* Breadcrumb skeleton */}
          <div className="h-4 bg-slate-400/20 rounded w-1/4"></div>

          {/* Header card skeleton */}
          <div
            className="rounded p-6 border space-y-3"
            style={{ backgroundColor: cardBg, borderColor }}
          >
            <div className="h-6 bg-slate-400/20 rounded w-1/2"></div>
            <div className="h-3 bg-slate-400/10 rounded w-1/3"></div>
          </div>

          {/* Buttons row skeleton */}
          <div className="flex gap-3">
            <div className="h-8 bg-slate-400/20 rounded w-24"></div>
            <div className="h-8 bg-slate-400/20 rounded w-24"></div>
            <div className="h-8 bg-slate-400/20 rounded w-28"></div>
          </div>

          {/* Two-column layout skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Semantic card skeleton */}
              <div
                className="rounded p-5 border space-y-4"
                style={{ backgroundColor: cardBg, borderColor }}
              >
                <div className="h-4 bg-slate-400/20 rounded w-1/4"></div>
                <div className="space-y-2">
                  <div className="h-3 bg-slate-400/10 rounded w-full"></div>
                  <div className="h-3 bg-slate-400/10 rounded w-5/6"></div>
                </div>
              </div>

              {/* Columns table skeleton */}
              <div className="space-y-2.5">
                <div className="h-4 bg-slate-400/20 rounded w-16"></div>
                <div
                  className="rounded border p-4 space-y-3"
                  style={{ backgroundColor: cardBg, borderColor }}
                >
                  <div className="h-5 bg-slate-400/20 rounded w-full"></div>
                  <div className="h-8 bg-slate-400/10 rounded w-full"></div>
                  <div className="h-8 bg-slate-400/10 rounded w-full"></div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Freshness card skeleton */}
              <div
                className="rounded p-5 border space-y-3"
                style={{ backgroundColor: cardBg, borderColor }}
              >
                <div className="h-4 bg-slate-400/20 rounded w-1/3"></div>
                <div className="space-y-2">
                  <div className="h-3 bg-slate-400/10 rounded w-full"></div>
                  <div className="h-3 bg-slate-400/10 rounded w-full"></div>
                </div>
              </div>

              {/* History timeline skeleton */}
              <div className="space-y-3">
                <div className="h-4 bg-slate-400/20 rounded w-1/3"></div>
                <div className="pl-6 space-y-4">
                  <div className="h-12 bg-slate-400/15 rounded"></div>
                  <div className="h-12 bg-slate-400/15 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center bg-[var(--background)]">
        <div
          className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-5 shadow-card"
          style={{
            backgroundColor: cardBg,
            borderColor: borderColor,
          }}
        >
          <span className="w-12 h-12 relative block" style={{ opacity: 0.7 }}>
            <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: '#FDB515' }} />
            <span className="absolute inset-3.5 border-2 rotate-45 opacity-60" style={{ borderColor: '#FDB515' }} />
          </span>

          <h2
            className="text-xl font-serif font-semibold"
            style={{ color: inkColor, fontFamily: "'Source Serif 4', serif" }}
          >
            Object not found
          </h2>

          <p
            className="text-xs leading-relaxed"
            style={{ color: mutedColor, fontFamily: "'Inter Tight', sans-serif" }}
          >
            The object you are looking for does not exist in this data source or has been removed.
          </p>

          <button
            onClick={() => router.push('/agent-lab/estate/catalog')}
            className="font-mono text-xs text-[#FDB515] hover:underline cursor-pointer border-none bg-transparent"
          >
            &larr; back to catalog
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center bg-[var(--background)]">
        <div
          className="max-w-md w-full border border-dashed border-red-500/30 rounded-lg p-10 flex flex-col items-center text-center gap-5"
          style={{
            backgroundColor: cardBg,
          }}
        >
          <span className="text-red-500 font-bold text-3xl">⚠</span>
          <h2 className="text-lg font-semibold" style={{ color: inkColor }}>
            Failed to load object
          </h2>
          <p className="text-xs" style={{ color: mutedColor }}>
            {error}
          </p>
          <button
            onClick={() => router.push('/agent-lab/estate/catalog')}
            className="font-mono text-xs text-[#FDB515] hover:underline cursor-pointer border-none bg-transparent"
          >
            &larr; back to catalog
          </button>
        </div>
      </div>
    );
  }

  return <ObjectKnowledgePage data={data} />;
}
