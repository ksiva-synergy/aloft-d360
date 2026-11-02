'use client';

import { Select } from '@/components/form/Select';
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from '@/lib/navigation';
import { toast } from 'sonner';
import Link from '@/lib/navigation/link';
import { AlertCircle, ArrowRight, Check, Circle, Loader2, RotateCcw, Search, SearchX, Table2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CATALOG_BTN,
  CATALOG_BTN_PRIMARY,
  CATALOG_SELECT,
  CATALOG_SELECT_ARROW,
  ObjectNameCell,
  OverflowMenu,
  formatCompactCount,
} from '@/components/estate/catalog-ui';
import { LinkStatusPill, SiloStepper, SimilarityMeter, VerdictTag } from '@/components/estate/silo/silo-ui';

const CARD = 'rounded-card border border-[var(--estate-border-gold)] bg-[var(--estate-raised)]';
const TOP_N_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50];
const MIN_SCORE_OPTIONS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function kindLabel(kind: string | null | undefined): string {
  const k = (kind ?? '').toLowerCase();
  if (!k) return 'Table';
  if (k.includes('materialized')) return 'Materialized view';
  if (k.includes('view')) return 'View';
  if (k === 'external') return 'External table';
  return 'Table';
}

function SiloFinderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const objectIdParam = searchParams.get('objectId');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedObject, setSelectedObject] = useState<any | null>(null);

  // Scan options
  const [topN, setTopN] = useState(15);
  const [minScore, setMinScore] = useState(0.60);
  const [includeRejected, setIncludeRejected] = useState(false);

  // Scan job
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<any>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 3 Results
  const [links, setLinks] = useState<any[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [candidatesMap, setCandidatesMap] = useState<Record<string, any>>({});
  const [updatingLinks, setUpdatingLinks] = useState<Record<string, 'confirming' | 'rejecting' | null>>({});

  // 1. Pre-fill object from URL search params
  useEffect(() => {
    if (objectIdParam) {
      async function loadObject() {
        try {
          const res = await fetch(`/api/agent-lab/context/objects/${objectIdParam}`);
          if (res.ok) {
            const json = await res.json();
            if (json.data?.object) {
              const obj = json.data.object;
              setSelectedObject({
                id: obj.id,
                full_path: obj.full_path,
                summary: json.data.latestSemanticCard?.card?.summary || 'No summary available.',
                row_count_est: obj.row_count_est,
                catalog_name: obj.catalog_name,
                schema_name: obj.schema_name,
                source_id: obj.source_id,
                columnsCount: json.data.columns?.length || 0,
                entity_tags: obj.entity_tags,
                object_kind: obj.object_kind,
              });
            } else {
              toast.error('Object not found');
            }
          }
        } catch (err) {
          console.error(err);
          toast.error('Failed to load pre-filled object');
        }
      }
      void loadObject();
    }
  }, [objectIdParam]);

  // 2. Autocomplete search query debouncing
  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await fetch(
          `/api/agent-lab/context/objects?q=${encodeURIComponent(query)}&pageSize=8`
        );
        if (res.ok) {
          const json = await res.json();
          setSearchResults(json.data?.items || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // 3. Polling job for Step 2
  useEffect(() => {
    if (step !== 2 || !jobId) return;

    let intervalId: NodeJS.Timeout;
    let timeoutId: NodeJS.Timeout;

    const pollJob = async () => {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${jobId}`);
        if (res.ok) {
          const json = await res.json();
          const job = json.data;
          setJobData(job);

          if (job.status === 'succeeded') {
            clearInterval(intervalId);
            timeoutId = setTimeout(() => {
              setStep(3);
            }, 1200);
          } else if (job.status === 'failed') {
            clearInterval(intervalId);
            setJobError(job.error || 'Job execution failed.');
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    void pollJob();
    intervalId = setInterval(pollJob, 3000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [step, jobId]);

  // 4. Fetch links and candidate details on Step 3
  useEffect(() => {
    if (step !== 3 || !selectedObject?.id) return;

    async function loadLinksAndCandidates() {
      setLoadingLinks(true);
      try {
        const res = await fetch(`/api/agent-lab/context/silo/links?objectId=${selectedObject.id}&pageSize=100`);
        if (res.ok) {
          const json = await res.json();
          const items = json.data?.items || [];
          setLinks(items);

          const candidateIds = Array.from(new Set(
            items.map((item: any) =>
              item.left_object_id === selectedObject.id ? item.right_object_id : item.left_object_id
            )
          )) as string[];

          const map: Record<string, any> = {};
          await Promise.all(
            candidateIds.map(async (cid) => {
              try {
                const cRes = await fetch(`/api/agent-lab/context/objects/${cid}`);
                if (cRes.ok) {
                  const cJson = await cRes.json();
                  if (cJson.data) {
                    map[cid] = cJson.data;
                  }
                }
              } catch (err) {
                console.error(`Failed to fetch candidate ${cid}:`, err);
              }
            })
          );
          setCandidatesMap(map);
        }
      } catch (err) {
        console.error('Failed to load links:', err);
        toast.error('Failed to load silo link results.');
      } finally {
        setLoadingLinks(false);
      }
    }

    void loadLinksAndCandidates();
  }, [step, selectedObject?.id]);

  const handleSelectResult = async (item: any) => {
    try {
      const res = await fetch(`/api/agent-lab/context/objects/${item.id}`);
      if (res.ok) {
        const json = await res.json();
        const obj = json.data?.object;
        if (obj) {
          setSelectedObject({
            id: obj.id,
            full_path: obj.full_path,
            summary: json.data.latestSemanticCard?.card?.summary || 'No summary available.',
            row_count_est: obj.row_count_est,
            catalog_name: obj.catalog_name,
            schema_name: obj.schema_name,
            source_id: obj.source_id,
            columnsCount: json.data.columns?.length || 0,
            entity_tags: obj.entity_tags,
            object_kind: obj.object_kind,
          });
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load object details');
    }
  };

  const handleRunScan = async () => {
    if (!selectedObject || submitting) return;

    setSubmitting(true);
    setJobError(null);

    try {
      const res = await fetch('/api/agent-lab/context/silo/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectId: selectedObject.id,
          topN,
          minScore,
          includeRejected,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to start scan job.');
      }

      const json = await res.json();
      setJobId(json.data.jobId);
      setStep(2);
    } catch (err: any) {
      setJobError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSilo = async (linkId: string) => {
    setUpdatingLinks((prev) => ({ ...prev, [linkId]: 'confirming' }));
    try {
      const res = await fetch(`/api/agent-lab/context/silo/links/${linkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      if (res.ok) {
        setLinks((prev) =>
          prev.map((l) => (l.id === linkId ? { ...l, status: 'confirmed' } : l))
        );
        toast.success('Silo confirmed — entity tags recomputing in background');
      } else {
        throw new Error('Failed to update status');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to confirm silo link — please try again');
    } finally {
      setUpdatingLinks((prev) => ({ ...prev, [linkId]: null }));
    }
  };

  const handleRejectSilo = async (linkId: string) => {
    setUpdatingLinks((prev) => ({ ...prev, [linkId]: 'rejecting' }));
    try {
      const res = await fetch(`/api/agent-lab/context/silo/links/${linkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (res.ok) {
        setLinks((prev) =>
          prev.map((l) => (l.id === linkId ? { ...l, status: 'rejected' } : l))
        );
        toast.success('Link marked as not related');
      } else {
        throw new Error('Failed to update status');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to reject silo link — please try again');
    } finally {
      setUpdatingLinks((prev) => ({ ...prev, [linkId]: null }));
    }
  };

  const stages = [
    { key: 'embedding_search', label: 'Finding tables with similar meaning', durKey: 'embedding_search_duration_ms' },
    { key: 'signal_computation', label: 'Comparing columns and types', durKey: 'signal_computation_duration_ms' },
    { key: 'llm_adjudication', label: 'Reviewing candidates with AI', durKey: 'llm_adjudication_duration_ms' },
    { key: 'persist', label: 'Saving matches', durKey: 'persist_duration_ms' },
  ];

  const getStageStatus = (stageKey: string, index: number) => {
    if (jobData?.status === 'succeeded') return 'checked';
    const currentStage = jobData?.stats?.stage;
    const activeIndex = stages.findIndex((s) => s.key === currentStage);
    if (activeIndex === -1) {
      return (jobData && index === 0) ? 'current' : 'unchecked';
    }

    if (index < activeIndex) return 'checked';
    if (index === activeIndex) return 'current';
    return 'unchecked';
  };

  const handleReset = () => {
    setStep(1);
    setJobId(null);
    setJobData(null);
    setJobError(null);
  };

  const handleClear = () => {
    setSelectedObject(null);
    if (objectIdParam) {
      router.push('/agent-lab/estate/silo');
    }
  };

  const handleScanAnother = () => {
    setStep(1);
    setJobId(null);
    setJobData(null);
    setJobError(null);
    setLinks([]);
    setCandidatesMap({});
  };

  const getSharedTagNames = (candidateObj: any, selectedObj: any) => {
    const shared: string[] = [];
    if (!candidateObj || !selectedObj) return shared;
    const sourceGroups = (selectedObj.entity_tags as any)?.groups || [];
    const candidateGroups = (candidateObj.entity_tags as any)?.groups || [];

    const sourceLabels = new Set(sourceGroups.map((g: any) => g.label).filter(Boolean));
    for (const grp of candidateGroups) {
      if (grp.label && sourceLabels.has(grp.label)) {
        shared.push(grp.label);
      }
    }
    return shared;
  };

  const getLinkState = (link: any) => {
    const updating = updatingLinks[link.id];
    if (updating === 'confirming') return 'confirmed_loading';
    if (updating === 'rejecting') return 'rejected_loading';
    return link.status;
  };

  const sortedLinks = [...links].sort((a, b) => {
    const scoreA = a.signals?.compositeScore ?? 0;
    const scoreB = b.signals?.compositeScore ?? 0;
    return scoreB - scoreA;
  });

  const showResultList = query.trim().length >= 2;
  const stageDoneCount = stages.filter((s, i) => getStageStatus(s.key, i) === 'checked').length;
  const jobFailed = Boolean(jobError) || jobData?.status === 'failed';
  const reviewCounts = links.reduce(
    (acc, l) => {
      if (l.status === 'confirmed') acc.confirmed += 1;
      else if (l.status === 'rejected') acc.rejected += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, confirmed: 0, rejected: 0 },
  );

  const selectedHeader = selectedObject && (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-[var(--estate-text-muted)]">Compared against</span>
      <div className="text-ui">
        <ObjectNameCell path={selectedObject.full_path} kind={selectedObject.object_kind} />
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-[var(--background)] text-[var(--estate-ink)]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 py-5">
        {/* Page header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <SiloStepper step={step} />
        </header>

        {/* ── Step 1: choose table ─────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* Search card */}
              <section className={cn(CARD, 'flex min-h-[360px] flex-col')}>
                <div className="border-b border-[var(--estate-border)] px-5 pb-4 pt-4">
                  <h2 className="text-title-card text-[var(--estate-ink)]">Choose a table</h2>
                  <p className="mt-0.5 text-caption text-[var(--estate-text-muted)]">Search by table name or by what the data is about.</p>
                  <div className="relative mt-3">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--estate-text-dim)]" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search tables, e.g. customers or orders"
                      aria-label="Search tables"
                      className="h-9 w-full rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] pl-9 pr-9 text-ui text-[var(--estate-ink)] outline-none transition-colors placeholder:text-[var(--estate-text-dim)] focus-visible:border-[var(--brand-a)] focus-visible:shadow-[var(--focus-ring)]"
                    />
                    {searching && (
                      <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[var(--estate-text-dim)]" />
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {!showResultList ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                      <span className="flex size-9 items-center justify-center rounded-full bg-[var(--estate-hover)] text-[var(--estate-text-muted)]">
                        <Search className="size-4" />
                      </span>
                      <p className="text-ui text-[var(--estate-text-secondary)]">Start typing to search your catalog</p>
                      <p className="text-caption text-[var(--estate-text-muted)]">Type at least 2 characters.</p>
                    </div>
                  ) : searching && searchResults.length === 0 ? (
                    <div className="space-y-1.5 p-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-12 animate-pulse rounded-ctl bg-[var(--estate-hover)]" />
                      ))}
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                      <span className="flex size-9 items-center justify-center rounded-full bg-[var(--estate-hover)] text-[var(--estate-text-muted)]">
                        <SearchX className="size-4" />
                      </span>
                      <p className="text-ui text-[var(--estate-text-secondary)]">No tables match {'\u201c'}{query.trim()}{'\u201d'}</p>
                      <p className="text-caption text-[var(--estate-text-muted)]">Try a shorter name or a different word.</p>
                    </div>
                  ) : (
                    <ul className="space-y-0.5" role="listbox" aria-label="Search results">
                      {searchResults.map((item) => {
                        const isSelected = selectedObject?.id === item.id;
                        const rows = formatCompactCount(item.row_count_est);
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => void handleSelectResult(item)}
                              className={cn(
                                'group relative flex w-full items-start gap-3 rounded-ctl px-3 py-2.5 text-left transition-colors',
                                isSelected
                                  ? 'bg-[var(--estate-active-bg)] ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--brand-a)_45%,transparent)]'
                                  : 'hover:bg-[var(--estate-hover)]',
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-3">
                                  <span className="min-w-0 flex-1">
                                    <ObjectNameCell path={item.full_path} kind={item.object_kind} />
                                  </span>
                                  <span className="shrink-0 text-caption tabular-nums text-[var(--estate-text-muted)]">
                                    {kindLabel(item.object_kind)}
                                    {rows ? ` \u00b7 ${rows} rows` : ''}
                                  </span>
                                </span>
                                <span className="mt-0.5 block truncate pl-[22px] text-caption text-[var(--estate-text-muted)]">
                                  {item.semantic_summary || 'No description yet.'}
                                </span>
                              </span>
                              <span
                                aria-hidden
                                className={cn(
                                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                  isSelected
                                    ? 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]'
                                    : 'border-[var(--estate-border)] group-hover:border-[var(--estate-text-muted)]',
                                )}
                              >
                                {isSelected && <Check className="size-3" strokeWidth={3} />}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              {/* Selected table card */}
              <aside className={cn(CARD, 'flex flex-col self-start p-5')}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-label text-[var(--estate-text-secondary)]">Selected table</h2>
                  {selectedObject && (
                    <button type="button" onClick={handleClear} className={CATALOG_BTN}>
                      <X className="size-3.5" /> Clear
                    </button>
                  )}
                </div>

                {selectedObject ? (
                  <div className="mt-3 flex flex-1 flex-col gap-4">
                    <div className="text-ui">
                      <ObjectNameCell path={selectedObject.full_path} kind={selectedObject.object_kind} />
                    </div>
                    <p className="line-clamp-5 text-ui-regular text-[var(--estate-text-secondary)]">{selectedObject.summary}</p>
                    <dl className="grid grid-cols-3 gap-2 border-t border-[var(--estate-border)] pt-4">
                      <div>
                        <dt className="text-caption text-[var(--estate-text-muted)]">Rows</dt>
                        <dd className="text-kpi-sm tabular-nums text-[var(--estate-ink)]">
                          {formatCompactCount(selectedObject.row_count_est) ?? '\u2014'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-[var(--estate-text-muted)]">Columns</dt>
                        <dd className="text-kpi-sm tabular-nums text-[var(--estate-ink)]">{selectedObject.columnsCount || '\u2014'}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-caption text-[var(--estate-text-muted)]">Schema</dt>
                        <dd className="truncate pt-1 font-mono text-ui-regular text-[var(--estate-ink)]" title={selectedObject.schema_name ?? undefined}>
                          {selectedObject.schema_name || '\u2014'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
                    <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-[var(--estate-border)] text-[var(--estate-text-dim)]">
                      <Table2 className="size-4" />
                    </span>
                    <p className="text-ui text-[var(--estate-text-secondary)]">No table selected</p>
                    <p className="max-w-[240px] text-caption text-[var(--estate-text-muted)]">
                      Pick a table from the list. We will compare it with the rest of your data.
                    </p>
                  </div>
                )}
              </aside>
            </div>

            {/* Options + action */}
            <section className={cn(CARD, 'flex flex-wrap items-end gap-x-6 gap-y-4 px-5 py-4')}>
              <div className="flex flex-col gap-1">
                <span className="text-label text-[var(--estate-ink)]">Options</span>
                <span className="text-caption text-[var(--estate-text-muted)]">Fine-tune the search.</span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-[var(--estate-text-muted)]">Max results</span>
                <Select
                  value={topN}
                  onChange={(e) => setTopN(Math.min(50, Math.max(5, Number(e.target.value) || 5)))}
                  className={cn(CATALOG_SELECT, 'w-28 tabular-nums')}
                  style={CATALOG_SELECT_ARROW}
                >
                  {(TOP_N_OPTIONS.includes(topN) ? TOP_N_OPTIONS : [...TOP_N_OPTIONS, topN].sort((a, b) => a - b)).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-[var(--estate-text-muted)]">Minimum similarity</span>
                <Select
                  value={String(minScore)}
                  onChange={(e) => setMinScore(Math.min(1.0, Math.max(0.0, Number(e.target.value) || 0.0)))}
                  className={cn(CATALOG_SELECT, 'w-32 tabular-nums')}
                  style={CATALOG_SELECT_ARROW}
                >
                  {(MIN_SCORE_OPTIONS.includes(minScore) ? MIN_SCORE_OPTIONS : [...MIN_SCORE_OPTIONS, minScore].sort((a, b) => a - b)).map((v) => (
                    <option key={v} value={String(v)}>{Math.round(v * 100)}% or more</option>
                  ))}
                </Select>
              </label>
              <label className="flex h-9 cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeRejected}
                  onChange={(e) => setIncludeRejected(e.target.checked)}
                  className="size-3.5 cursor-pointer accent-[var(--brand-a)]"
                />
                <span className="text-ui text-[var(--estate-text-secondary)]">Include previously rejected</span>
              </label>

              <div className="ml-auto flex items-center gap-3">
                {!selectedObject && <span className="text-caption text-[var(--estate-text-muted)]">Choose a table first</span>}
                <button
                  type="button"
                  onClick={handleRunScan}
                  disabled={!selectedObject || submitting}
                  className={CATALOG_BTN_PRIMARY}
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {submitting ? 'Starting\u2026' : 'Find similar data'}
                  {!submitting && <ArrowRight className="size-3.5" />}
                </button>
              </div>
            </section>

            {jobError && (
              <div role="alert" className="flex items-start gap-2 rounded-card bg-[var(--bad-bg)] px-4 py-3 text-ui text-[var(--bad)]">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{jobError}</span>
              </div>
            )}
          </>
        )}

        {/* ── Step 2: searching ────────────────────────────────────────── */}
        {step === 2 && (
          <section className={cn(CARD, 'mx-auto w-full max-w-[640px] p-6')}>
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  jobFailed ? 'bg-[var(--bad-bg)] text-[var(--bad)]' : 'bg-[var(--estate-active-bg)] text-[var(--brand-a)]',
                )}
              >
                {jobFailed ? (
                  <AlertCircle className="size-4" />
                ) : jobData?.status === 'succeeded' ? (
                  <Check className="size-4" strokeWidth={2.5} />
                ) : (
                  <Loader2 className="size-4 animate-spin" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-title-card text-[var(--estate-ink)]">
                  {jobFailed ? 'The search stopped' : jobData?.status === 'succeeded' ? 'Search complete' : 'Looking for similar data\u2026'}
                </h2>
                {selectedObject && (
                  <div className="mt-1 text-ui">
                    <ObjectNameCell path={selectedObject.full_path} kind={selectedObject.object_kind} />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--estate-text-dim)_18%,transparent)]">
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', jobFailed ? 'bg-[var(--bad)]' : 'bg-[var(--brand-a)]')}
                style={{ width: `${Math.max(6, (stageDoneCount / stages.length) * 100)}%` }}
              />
            </div>

            <ol className="mt-5 flex flex-col gap-3">
              {stages.map((stage, idx) => {
                const status = getStageStatus(stage.key, idx);
                const duration = jobData?.stats?.[stage.durKey];
                return (
                  <li key={stage.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      {status === 'checked' ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-[var(--brand-a)] text-[var(--on-brand)]">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      ) : status === 'current' && !jobFailed ? (
                        <Loader2 className="size-5 animate-spin text-[var(--brand-a)]" />
                      ) : (
                        <Circle className="size-5 text-[var(--estate-border)]" />
                      )}
                      <span
                        className={cn(
                          'text-ui',
                          status === 'unchecked' ? 'text-[var(--estate-text-muted)]' : 'text-[var(--estate-ink)]',
                          status === 'current' && 'font-medium',
                        )}
                      >
                        {stage.label}
                      </span>
                    </span>
                    {duration !== undefined && (
                      <span className="text-caption tabular-nums text-[var(--estate-text-muted)]">{(duration / 1000).toFixed(1)}s</span>
                    )}
                  </li>
                );
              })}
            </ol>

            {jobData?.status === 'succeeded' && (
              <p className="mt-5 border-t border-[var(--estate-border)] pt-4 text-ui-regular text-[var(--estate-text-secondary)]">
                <span className="tabular-nums text-[var(--estate-ink)]">{jobData.stats?.candidates_found ?? 0}</span> possible matches found
                {' \u00b7 '}
                <span className="tabular-nums">{jobData.scope?.topN ?? jobData.stats?.scanned_count ?? 15}</span> tables checked. Opening results{'\u2026'}
              </p>
            )}

            {jobFailed && (
              <div className="mt-5 flex flex-col gap-3 border-t border-[var(--estate-border)] pt-4">
                <div role="alert" className="flex items-start gap-2 rounded-ctl bg-[var(--bad-bg)] px-3 py-2.5 text-ui text-[var(--bad)]">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{jobError || jobData?.error || 'Job execution failed.'}</span>
                </div>
                <button type="button" onClick={handleReset} className={cn(CATALOG_BTN, 'self-start')}>
                  <RotateCcw className="size-3.5" /> Try again
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Step 3: results ──────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <section className={cn(CARD, 'flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4')}>
              <div className="min-w-0 flex-1">{selectedHeader}</div>
              {!loadingLinks && links.length > 0 && (
                <dl className="flex items-center gap-6">
                  <div>
                    <dt className="text-caption text-[var(--estate-text-muted)]">Matches</dt>
                    <dd className="text-kpi-sm tabular-nums text-[var(--estate-ink)]">{links.length}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-[var(--estate-text-muted)]">To review</dt>
                    <dd className="text-kpi-sm tabular-nums text-[var(--estate-ink)]">{reviewCounts.open}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-[var(--estate-text-muted)]">Confirmed</dt>
                    <dd className="text-kpi-sm tabular-nums text-[var(--ok)]">{reviewCounts.confirmed}</dd>
                  </div>
                </dl>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleScanAnother} className={CATALOG_BTN}>
                  <RotateCcw className="size-3.5" /> Start over
                </button>
                {selectedObject?.id && (
                  <OverflowMenu
                    items={[
                      {
                        label: 'Open table details',
                        hint: 'Columns, profile and lineage',
                        onSelect: () => router.push(`/agent-lab/estate/object/${selectedObject.id}`),
                      },
                      {
                        label: 'Change options and search again',
                        hint: 'Keeps this table selected',
                        onSelect: handleReset,
                      },
                    ]}
                  />
                )}
              </div>
            </section>

            {loadingLinks ? (
              <section className={cn(CARD, 'space-y-2 p-4')}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-ctl bg-[var(--estate-hover)]" />
                ))}
              </section>
            ) : links.length === 0 ? (
              <section className={cn(CARD, 'flex flex-col items-center gap-2 px-6 py-14 text-center')}>
                <span className="flex size-10 items-center justify-center rounded-full bg-[var(--estate-hover)] text-[var(--estate-text-muted)]">
                  <SearchX className="size-5" />
                </span>
                <p className="text-ui text-[var(--estate-ink)]">No similar data found</p>
                <p className="max-w-sm text-caption text-[var(--estate-text-muted)]">
                  Nothing scored above {Math.round(minScore * 100)}% similarity. Try a lower minimum or another table.
                </p>
                <button type="button" onClick={handleScanAnother} className={cn(CATALOG_BTN, 'mt-2')}>
                  <RotateCcw className="size-3.5" /> Try another table
                </button>
              </section>
            ) : (
              <section className={cn(CARD, 'overflow-hidden')}>
                <div className="flex items-center justify-between border-b border-[var(--estate-border)] px-5 py-3">
                  <h2 className="text-label text-[var(--estate-ink)]">Possible matches</h2>
                  <span className="text-caption tabular-nums text-[var(--estate-text-muted)]">
                    {links.length} found {'\u00b7'} {jobData?.scope?.topN ?? topN} checked {'\u00b7'} best match first
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed border-collapse text-left">
                    <colgroup>
                      <col className="w-[30%]" />
                      <col className="w-[15%]" />
                      <col />
                      <col className="w-[116px]" />
                      <col className="w-[200px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[var(--estate-border)] text-caption text-[var(--estate-text-muted)]">
                        <th className="px-5 py-2 font-medium">Match</th>
                        <th className="px-3 py-2 font-medium">Similarity</th>
                        <th className="px-3 py-2 font-medium">Why</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-5 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLinks.map((link) => {
                        const candidateId = link.left_object_id === selectedObject.id ? link.right_object_id : link.left_object_id;
                        const candidateData = candidatesMap[candidateId];
                        const candidateObj = candidateData?.object;
                        const candidatePath = candidateObj?.full_path || 'Loading\u2026';
                        const candidateSummary = candidateData?.latestSemanticCard?.card?.summary || 'No description yet.';

                        const signals = link.signals || {};
                        const { embedCosine, columnNameOverlap, typeCompatRatio, sharedEntityTags, compositeScore } = signals;

                        const candidateColumnsCount = candidateData?.columns?.length || 0;
                        const sourceColumnsCount = selectedObject?.columnsCount || 0;
                        let colOverlapLabel = '';
                        if (sourceColumnsCount > 0 && candidateColumnsCount > 0) {
                          const M = Math.max(sourceColumnsCount, candidateColumnsCount);
                          const N = Math.round(columnNameOverlap * M);
                          colOverlapLabel = `${N} of ${M} columns shared`;
                        } else if (columnNameOverlap !== undefined && columnNameOverlap !== null) {
                          colOverlapLabel = `${(columnNameOverlap * 100).toFixed(0)}% columns shared`;
                        }

                        const sharedTagNames = getSharedTagNames(candidateObj, selectedObject);
                        const isSameSchema =
                          candidateObj?.schema_name === selectedObject?.schema_name &&
                          candidateObj?.catalog_name === selectedObject?.catalog_name &&
                          candidateObj?.source_id === selectedObject?.source_id;

                        const why = [
                          embedCosine !== undefined && embedCosine !== null
                            ? `${Math.round(embedCosine * 100)}% similar meaning`
                            : '',
                          colOverlapLabel,
                          typeCompatRatio !== undefined && typeCompatRatio !== null
                            ? `${(typeCompatRatio * 100).toFixed(0)}% matching types`
                            : '',
                          sharedEntityTags > 0
                            ? sharedTagNames.length > 0
                              ? `both about ${sharedTagNames.join(', ')}`
                              : `${sharedEntityTags} shared tags`
                            : '',
                        ].filter(Boolean);

                        const linkState = getLinkState(link);
                        const isRejected = linkState === 'rejected' || linkState === 'rejected_loading';
                        const isBusy = linkState === 'confirmed_loading' || linkState === 'rejected_loading';

                        return (
                          <tr
                            key={link.id}
                            className={cn(
                              'border-b border-[var(--estate-border)] align-top transition-colors last:border-b-0 hover:bg-[var(--estate-hover)]',
                              isRejected && 'opacity-60',
                            )}
                          >
                            <td className="px-5 py-3">
                              <Link
                                href={`/agent-lab/estate/object/${candidateId}`}
                                className="block min-w-0 rounded-xs hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                              >
                                <ObjectNameCell path={candidatePath} kind={candidateObj?.object_kind} />
                              </Link>
                              <div className="mt-1 pl-[22px] text-caption">
                                {candidateObj ? (
                                  isSameSchema ? (
                                    <span className="text-[var(--estate-text-muted)]">Same schema</span>
                                  ) : (
                                    <span className="font-medium text-[var(--brand-a)]" title="Lives in a different schema or source: a possible silo">
                                      Other location
                                    </span>
                                  )
                                ) : null}
                                <p className="mt-0.5 line-clamp-2 text-[var(--estate-text-muted)]" title={candidateSummary}>{candidateSummary}</p>
                              </div>
                            </td>
                            <td className="px-3 py-3.5">
                              <SimilarityMeter score={compositeScore} />
                            </td>
                            <td className="px-3 py-3">
                              {link.llm_verdict?.verdict && (
                                <VerdictTag verdict={link.llm_verdict.verdict} confidence={link.llm_verdict.confidence} />
                              )}
                              {link.llm_verdict?.reasoning && (
                                <p className="mt-0.5 line-clamp-2 text-caption text-[var(--estate-text-secondary)]" title={link.llm_verdict.reasoning}>
                                  {link.llm_verdict.reasoning}
                                </p>
                              )}
                              {why.length > 0 && (
                                <p className="mt-1 text-caption text-[var(--estate-text-muted)]">{why.join(' \u00b7 ')}</p>
                              )}
                            </td>
                            <td className="px-3 py-3.5">
                              <LinkStatusPill state={linkState} />
                            </td>
                            <td className="px-5 py-3">
                              {linkState === 'proposed' ? (
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleRejectSilo(link.id)}
                                    className={CATALOG_BTN}
                                    title="Mark as not related"
                                  >
                                    <X className="size-3.5" /> Reject
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleConfirmSilo(link.id)}
                                    className={cn(CATALOG_BTN, 'hover:border-[var(--ok)] hover:text-[var(--ok)]')}
                                    title="Confirm this is the same data"
                                  >
                                    <Check className="size-3.5" /> Confirm
                                  </button>
                                </div>
                              ) : (
                                <div className="flex h-7 items-center justify-end text-caption text-[var(--estate-text-dim)]">
                                  {isBusy ? 'Saving\u2026' : 'Reviewed'}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function EstateSiloPage() {
  return (
    <Suspense fallback={<div className="p-6 font-sans text-ui text-[var(--estate-text-muted)]">Loading{'\u2026'}</div>}>
      <SiloFinderContent />
    </Suspense>
  );
}
