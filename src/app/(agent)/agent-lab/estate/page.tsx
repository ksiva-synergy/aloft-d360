'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ScanSearch, RefreshCw } from 'lucide-react';
import SourceCard from '@/components/estate/SourceCard';
import ScanCoverageModal from '@/components/estate/ScanCoverageModal';
import type { ScanCoverageResult } from '@/components/estate/ScanCoverageModal';
import { isTestSourceDisplayName } from '@/lib/context/test-sources';

interface Source {
  id: string;
  display_name: string | null;
  connection_kind: string;
  connection_ref: string;
  scope_include: any;
  status: string;
}

interface CoverageData {
  estate_total: number;
  objects_total: number;
  profiled: number;
  enriched: number;
  embedded: number;
  last_t0_at: string | null;
  last_t1_at: string | null;
  last_inventoried_at: string | null;
  stale_count: number;
  queued_count: number;
}

interface SourceWithStats {
  source: Source;
  coverage: CoverageData;
}

function relativeTime(iso: string | Date | null): string {
  if (!iso) return '—';
  const dateObj = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - dateObj.getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return dateObj.toLocaleDateString();
}

function getCatalogName(scopeInclude: any): string {
  if (Array.isArray(scopeInclude) && scopeInclude.length > 0 && typeof scopeInclude[0] === 'string') {
    const parts = scopeInclude[0].split('.');
    return parts[0] || 'hive_metastore';
  }
  return 'hive_metastore';
}

export default function EstateOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [sourcesData, setSourcesData] = useState<SourceWithStats[]>([]);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanCoverageResult | null>(null);

  const inkColor = 'var(--estate-ink)';
  const mutedColor = 'var(--estate-text-secondary)';
  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';

  const handleScanCoverage = useCallback(async () => {
    if (sourcesData.length === 0) return;
    setScanModalOpen(true);
    setScanLoading(true);
    setScanResult(null);
    try {
      const res = await fetch('/api/agent-lab/context/estate/scan-coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: sourcesData[0].source.id }),
      });
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
      const data: ScanCoverageResult = await res.json();
      setScanResult(data);
    } catch (err) {
      console.error('Scan coverage error:', err);
    } finally {
      setScanLoading(false);
    }
  }, [sourcesData]);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Step 1: List all sources
        const sourcesRes = await fetch('/api/agent-lab/context/sources');
        if (!sourcesRes.ok) throw new Error('Failed to load sources');
        
        const { sources } = (await sourcesRes.json()) as { sources: Source[] };
        const productionSources = sources.filter(s => !isTestSourceDisplayName(s.display_name));
        
        // Step 2: Fetch stats for each source in parallel
        const stats = await Promise.all(
          productionSources.map(async (source) => {
            try {
              // Get coverage data
              const covRes = await fetch(`/api/agent-lab/context/sources/${source.id}/coverage`);
              if (!covRes.ok) throw new Error(`Coverage fetch failed: ${covRes.status}`);
              const covJson = await covRes.json();
              const coverage = covJson.data as CoverageData;
              return { source, coverage };
            } catch (err) {
              console.error(`Error loading stats for source ${source.id}:`, err);
              // Fallback default statistics
              return {
                source,
                coverage: {
                  estate_total: 0,
                  objects_total: 0,
                  profiled: 0,
                  enriched: 0,
                  embedded: 0,
                  last_t0_at: null,
                  last_t1_at: null,
                  last_inventoried_at: null,
                  stale_count: 0,
                  queued_count: 0,
                },
              };
            }
          })
        );
        
        setSourcesData(stats);
      } catch (err) {
        console.error('Error loading Data Estate sources:', err);
      } finally {
        setLoading(false);
      }
    }
    
    void loadData();
  }, []);

  return (
    <div className="p-6 overflow-y-auto h-full scrollbar-thin bg-[var(--background)]">
      <div className="max-w-[1180px] mx-auto">
        {/* Page Header */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: inkColor, fontFamily: "'Source Serif 4', serif" }}
            >
              Data Estate
            </h1>
            <p
              className="text-sm mt-1.5"
              style={{ color: mutedColor, fontFamily: "'Inter Tight', sans-serif" }}
            >
              Mendeleev context harness — what ALOFT knows about your data
            </p>
          </div>
          {sourcesData.length > 0 && (
            <button
              type="button"
              onClick={handleScanCoverage}
              disabled={scanLoading}
              className="font-mono text-[11px] font-semibold tracking-wider uppercase border rounded px-3.5 py-2 cursor-pointer transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
              style={{ borderColor: '#FDB515', color: '#FDB515', backgroundColor: 'transparent' }}
            >
              {scanLoading ? <RefreshCw size={12} className="animate-spin" /> : <ScanSearch size={12} />}
              {scanLoading ? 'Scanning...' : 'Scan Coverage'}
            </button>
          )}
        </div>

        {/* Content Section */}
        {loading ? (
          // Loading Skeleton matching SourceCard layout & sizing
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse h-[300px] border rounded p-5 flex flex-col justify-between shadow-card"
                style={{
                  backgroundColor: cardBg,
                  borderColor: borderColor,
                }}
              >
                <div className="flex justify-between">
                  <div className="space-y-3 w-1/3">
                    <div className="h-4 bg-slate-400/20 rounded"></div>
                    <div className="h-3 bg-slate-400/20 rounded w-2/3"></div>
                  </div>
                  <div className="h-3 bg-slate-400/20 rounded w-1/4"></div>
                </div>
                <div className="space-y-4 py-4">
                  <div className="h-2 bg-slate-400/20 rounded"></div>
                  <div className="h-2 bg-slate-400/20 rounded"></div>
                  <div className="h-2 bg-slate-400/20 rounded"></div>
                  <div className="h-2 bg-slate-400/20 rounded"></div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 bg-slate-400/20 rounded w-24"></div>
                  <div className="h-8 bg-slate-400/20 rounded w-28"></div>
                </div>
              </div>
            ))}
          </div>
        ) : sourcesData.length === 0 ? (
          // Empty State
          <div className="flex justify-center py-12">
            <div
              className="max-w-md w-full border border-dashed rounded-lg p-10 flex flex-col items-center text-center gap-5 shadow-card"
              style={{
                backgroundColor: cardBg,
                borderColor: borderColor,
              }}
            >
              {/* Diamond Icon */}
              <span className="w-12 h-12 relative block" style={{ opacity: 0.7 }}>
                <span className="absolute inset-0 border-2 rotate-45" style={{ borderColor: '#FDB515' }} />
                <span className="absolute inset-3.5 border-2 rotate-45 opacity-60" style={{ borderColor: '#FDB515' }} />
              </span>

              {/* Title */}
              <h2
                className="text-xl font-serif font-semibold"
                style={{ color: inkColor, fontFamily: "'Source Serif 4', serif" }}
              >
                No sources configured
              </h2>

              {/* Description */}
              <p
                className="text-xs leading-relaxed"
                style={{ color: mutedColor, fontFamily: "'Inter Tight', sans-serif" }}
              >
                Connect a data source to begin cataloging your data estate.
              </p>

              {/* Action Link */}
              <Link
                href="/databricks"
                className="font-mono text-xs text-[#FDB515] hover:underline"
              >
                Go to Connections &rarr;
              </Link>
            </div>
          </div>
        ) : (
          // Source Cards Grid
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sourcesData.map(({ source, coverage }) => {
              const displayCoverage = [
                {
                  label: 'Harvested',
                  count: coverage.objects_total,
                  color: '#2DD4A0',
                  // Harvested uses estate_total as denominator (coverage of full catalog)
                },
                {
                  label: 'Profiled',
                  count: coverage.profiled,
                  color: '#5B9DFF',
                  denominator: coverage.objects_total, // of what's been harvested
                },
                {
                  label: 'Enriched',
                  count: coverage.enriched,
                  color: '#A78BFA',
                  denominator: coverage.objects_total, // of what's been harvested
                },
                {
                  label: 'Embedded',
                  count: coverage.embedded,
                  color: '#FDB515',
                  denominator: coverage.objects_total, // of what's been harvested
                },
                {
                  label: 'T3 Harvest',
                  count: coverage.embedded,
                  color: '#F97316',
                  denominator: coverage.profiled, // embedded as % of profiled (T3 pipeline depth)
                },
              ];

              const rawName = source.display_name || 'Unnamed Source';
              const displayName = rawName.replace(/verify-estate-\d+/i, 'Synergy Lakehouse');

              return (
                <SourceCard
                  key={source.id}
                  sourceId={source.id}
                  sourceName={displayName}
                  sourceKind={source.connection_kind}
                  catalogName={getCatalogName(source.scope_include)}
                  totalObjects={coverage.objects_total}
                  estateTotal={coverage.estate_total}
                  lastSweep={relativeTime(coverage.last_inventoried_at)}
                  queuedJobs={coverage.queued_count}
                  staleObjects={coverage.stale_count}
                  coverage={displayCoverage}
                />
              );
            })}
          </div>
        )}
      </div>

      <ScanCoverageModal
        isOpen={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        data={scanResult}
        loading={scanLoading}
      />
    </div>
  );
}
