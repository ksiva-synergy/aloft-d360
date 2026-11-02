'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from '@/lib/navigation/link';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Clock, Database, RefreshCw, ScanLine, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SourceCard, { SOURCE_GRID, queueSourceScan } from '@/components/estate/SourceCard';
import { CATALOG_BTN } from '@/components/estate/catalog-ui';
import { cn } from '@/lib/utils';
import ScanCoverageModal from '@/components/estate/ScanCoverageModal';
import type { ScanCoverageResult } from '@/components/estate/ScanCoverageModal';
import { isTestSourceDisplayName } from '@/lib/context/test-sources';
import { ESTATE_STAGE, ESTATE_STAGES, formatCount, percentOf, estateStageDisplayLabel } from '@/lib/estate/stages';

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

const EMPTY_COVERAGE: CoverageData = {
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
};

function relativeTime(iso: string | Date | null): string | null {
  if (!iso) return null;
  const dateObj = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - dateObj.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days} d ago`;
  return dateObj.toLocaleDateString();
}

function getCatalogName(scopeInclude: any): string {
  if (Array.isArray(scopeInclude) && scopeInclude.length > 0 && typeof scopeInclude[0] === 'string') {
    const parts = scopeInclude[0].split('.');
    return parts[0] || 'hive_metastore';
  }
  return 'hive_metastore';
}

function FunnelStep({ label, help, color, count, pct, of, first }: { label: string; help: string; color: string; count: number; pct: number | null; of?: string; first?: boolean }) {
  return (
    <div className="relative min-w-0 flex-1 px-5 py-4" title={help}>
      {!first && (
        <ChevronRight aria-hidden className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-[var(--estate-raised)] text-[var(--estate-text-dim)]" />
      )}
      <div className="flex items-center gap-1.5 text-caption text-[var(--estate-text-muted)]">
        <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-1 text-kpi-sm tabular-nums text-[var(--estate-ink)]">{formatCount(count)}</div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--estate-hover)]">
        <div className="h-full rounded-full" style={{ width: `${pct ?? 100}%`, background: color }} />
      </div>
      <div className="mt-1.5 text-caption tabular-nums text-[var(--estate-text-muted)]">
        {pct === null ? 'in connected sources' : `${pct}% ${of}`}
      </div>
    </div>
  );
}

interface AttentionItem {
  key: string;
  tone: 'warn' | 'info';
  text: React.ReactNode;
  action: React.ReactNode;
}
export default function EstateOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [sourcesData, setSourcesData] = useState<SourceWithStats[]>([]);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanCoverageResult | null>(null);
  const [showAllAttention, setShowAllAttention] = useState(false);

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
        const sourcesRes = await fetch('/api/agent-lab/context/sources');
        if (!sourcesRes.ok) throw new Error('Failed to load sources');

        const { sources } = (await sourcesRes.json()) as { sources: Source[] };
        const productionSources = sources.filter((s) => !isTestSourceDisplayName(s.display_name));

        const stats = await Promise.all(
          productionSources.map(async (source) => {
            try {
              const covRes = await fetch(`/api/agent-lab/context/sources/${source.id}/coverage`);
              if (!covRes.ok) throw new Error(`Coverage fetch failed: ${covRes.status}`);
              const covJson = await covRes.json();
              return { source, coverage: covJson.data as CoverageData };
            } catch (err) {
              console.error(`Error loading stats for source ${source.id}:`, err);
              return { source, coverage: EMPTY_COVERAGE };
            }
          }),
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

  const totals = sourcesData.reduce(
    (acc, { coverage: c }) => ({
      found: acc.found + Math.max(c.estate_total, c.objects_total),
      scanned: acc.scanned + c.objects_total,
      profiled: acc.profiled + c.profiled,
      described: acc.described + c.enriched,
      searchable: acc.searchable + c.embedded,
    }),
    { found: 0, scanned: 0, profiled: 0, described: 0, searchable: 0 },
  );

  const funnel = [
    { ...ESTATE_STAGE.discovered, label: 'Found', color: 'var(--estate-text-muted)', count: totals.found, pct: null as number | null, of: '' },
    { ...ESTATE_STAGE.scanned, label: estateStageDisplayLabel(ESTATE_STAGE.scanned), count: totals.scanned, pct: percentOf(totals.scanned, totals.found), of: 'of found' },
    { ...ESTATE_STAGE.profiled, label: estateStageDisplayLabel(ESTATE_STAGE.profiled), count: totals.profiled, pct: percentOf(totals.profiled, totals.scanned), of: 'of scanned' },
    { ...ESTATE_STAGE.enriched, label: estateStageDisplayLabel(ESTATE_STAGE.enriched), count: totals.described, pct: percentOf(totals.described, totals.scanned), of: 'of scanned' },
    { ...ESTATE_STAGE.searchable, label: estateStageDisplayLabel(ESTATE_STAGE.searchable), count: totals.searchable, pct: percentOf(totals.searchable, totals.scanned), of: 'of scanned' },
  ];

  const nameOf = (s: Source) => (s.display_name || 'Unnamed source').replace(/verify-estate-\d+/i, 'Synergy Lakehouse');
  const attention: AttentionItem[] = [];
  for (const { source, coverage: c } of sourcesData) {
    const found = Math.max(c.estate_total, c.objects_total);
    if (c.objects_total === 0) {
      attention.push({
        key: `never-${source.id}`,
        tone: 'warn',
        text: <><b className="font-medium text-[var(--estate-ink)]">{nameOf(source)}</b> has never been scanned{found > 0 ? ` \u00b7 ${formatCount(found)} objects waiting` : ''}</>,
        action: (
          <button type="button" className={CATALOG_BTN} onClick={() => { void queueSourceScan(source.id); }}>
            <ScanLine aria-hidden className="size-3.5" /> Scan now
          </button>
        ),
      });
      continue;
    }
    if (c.stale_count > 0) {
      attention.push({
        key: `stale-${source.id}`,
        tone: 'warn',
        text: <><b className="font-medium text-[var(--estate-ink)]">{formatCount(c.stale_count)} objects</b> in {nameOf(source)} haven{'\u2019'}t been re-scanned in 7 days</>,
        action: <Link href="/agent-lab/estate/catalog" className={CATALOG_BTN}>Review</Link>,
      });
    }
    const unscanned = found - c.objects_total;
    if (unscanned > 0) {
      attention.push({
        key: `unscanned-${source.id}`,
        tone: 'info',
        text: <><b className="font-medium text-[var(--estate-ink)]">{formatCount(unscanned)} objects</b> in {nameOf(source)} were found but not scanned</>,
        action: <Link href="/agent-lab/estate/catalog" className={CATALOG_BTN}>Open Catalog</Link>,
      });
    }
  }
  const queued = sourcesData.reduce((n, s) => n + s.coverage.queued_count, 0);
  if (queued > 0) {
    attention.push({
      key: 'queued',
      tone: 'info',
      text: <><b className="font-medium text-[var(--estate-ink)]">{formatCount(queued)} jobs</b> are queued and will run soon</>,
      action: <Link href="/agent-lab/estate/jobs" className={CATALOG_BTN}>Open Jobs</Link>,
    });
  }

  attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'warn' ? -1 : 1));
  const ATTENTION_LIMIT = 4;
  const visibleAttention = showAllAttention ? attention : attention.slice(0, ATTENTION_LIMIT);

  const card = 'rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)]';
  const sectionTitle = 'text-title-card text-[var(--estate-ink)]';

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] px-4 py-5 scrollbar-thin md:px-6">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
        {loading ? (
          <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading sources">
            <div className={cn(card, 'h-[120px] animate-pulse')} />
            <div className={cn(card, 'h-[220px] animate-pulse')} />
          </div>
        ) : sourcesData.length === 0 ? (
          <div className="mx-auto mt-8 flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-[var(--estate-border-gold)] bg-[var(--estate-raised)] p-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-card bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink,var(--brand-a))]">
              <Database aria-hidden className="size-6" />
            </span>
            <h2 className="text-title-card text-[var(--estate-ink)]">No data sources yet</h2>
            <p className="text-ui-regular text-[var(--estate-text-secondary)]">
              Connect a warehouse or lakehouse and ALOFT will scan it here.
            </p>
            <Button asChild className="mt-2">
              <Link href="/agent-staging/connections">
                Add a connection
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <section aria-labelledby="estate-funnel">
              <div className="mb-2.5 flex items-end justify-between gap-3">
                <div>
                  <h2 id="estate-funnel" className={sectionTitle}>Pipeline progress</h2>
                  <p className="text-caption text-[var(--estate-text-muted)]">
                    {formatCount(totals.searchable)} of {formatCount(totals.found)} objects across {sourcesData.length} source{sourcesData.length === 1 ? '' : 's'} are ready for agents
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleScanCoverage}
                  disabled={scanLoading}
                  title="Compare the source catalog with what has been scanned"
                  className={cn(CATALOG_BTN, 'h-8')}
                >
                  {scanLoading ? <RefreshCw aria-hidden className="size-3.5 animate-spin" /> : <ScanSearch aria-hidden className="size-3.5" />}
                  {scanLoading ? 'Checking\u2026' : 'Check coverage'}
                </button>
              </div>
              <div className={cn(card, 'flex flex-col divide-y divide-[var(--estate-border)] md:flex-row md:divide-x md:divide-y-0')}>
                {funnel.map((s, i) => (
                  <FunnelStep key={s.key} first={i === 0} label={s.label} help={s.help} color={s.color} count={s.count} pct={s.pct} of={s.of} />
                ))}
              </div>
            </section>

            <section aria-labelledby="estate-attention">
              <h2 id="estate-attention" className={cn(sectionTitle, 'mb-2.5')}>Needs attention</h2>
              {attention.length === 0 ? (
                <div className={cn(card, 'flex items-center gap-2.5 px-5 py-3.5 text-ui-regular text-[var(--estate-text-secondary)]')}>
                  <CheckCircle2 aria-hidden className="size-4 text-[var(--ok)]" />
                  Everything is scanned and up to date.
                </div>
              ) : (
                <ul className={cn(card, 'divide-y divide-[var(--estate-border)]')}>
                  {visibleAttention.map((a) => (
                    <li key={a.key} className="flex items-center gap-3 px-5 py-2.5">
                      {a.tone === 'warn'
                        ? <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--warn)]" />
                        : <Clock aria-hidden className="size-4 shrink-0 text-[var(--estate-text-muted)]" />}
                      <span className="min-w-0 flex-1 text-ui-regular text-[var(--estate-text-secondary)]">{a.text}</span>
                      <span className="shrink-0">{a.action}</span>
                    </li>
                  ))}
                  {attention.length > ATTENTION_LIMIT && (
                    <li className="px-5 py-2">
                      <button
                        type="button"
                        onClick={() => setShowAllAttention((v) => !v)}
                        className="text-label text-[var(--brand-a-ink,var(--brand-a))] hover:underline"
                      >
                        {showAllAttention ? 'Show less' : `Show all ${attention.length}`}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section aria-labelledby="estate-sources">
              <div className="mb-2.5 flex items-end justify-between gap-3">
                <h2 id="estate-sources" className={sectionTitle}>Sources</h2>
                <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--estate-text-muted)]" aria-label="Legend">
                  {ESTATE_STAGES.filter((s) => s.key !== 'discovered').map((s) => (
                    <li key={s.key} className="flex items-center gap-1.5" title={s.help}>
                      <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
                      {estateStageDisplayLabel(s)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={cn(card, 'overflow-hidden')}>
                <div className={cn(SOURCE_GRID, 'border-b border-[var(--estate-border)] px-5 py-2 text-caption uppercase tracking-wide text-[var(--estate-text-muted)]')}>
                  <span>Source</span>
                  <span>Progress</span>
                  <span className="text-right">{estateStageDisplayLabel(ESTATE_STAGE.searchable)}</span>
                  <span>Last scan</span>
                  <span className="sr-only">Actions</span>
                </div>
                <ul className="divide-y divide-[var(--estate-border)]">
                  {sourcesData.map(({ source, coverage }) => (
                    <SourceCard
                      key={source.id}
                      sourceId={source.id}
                      sourceName={nameOf(source)}
                      sourceKind={source.connection_kind}
                      catalogName={getCatalogName(source.scope_include)}
                      lastScanned={relativeTime(coverage.last_inventoried_at)}
                      coverage={coverage}
                    />
                  ))}
                </ul>
              </div>
            </section>
          </>
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