'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';

const truncateText = (text: string, maxLen: number = 60) => {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
};

function SiloFinderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const objectIdParam = searchParams.get('objectId');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  // Colors / styling tokens
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const raisedBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';
  const activeColor = '#FDB515';

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
    { key: 'embedding_search', label: 'Embedding search', durKey: 'embedding_search_duration_ms' },
    { key: 'signal_computation', label: 'Signal computation', durKey: 'signal_computation_duration_ms' },
    { key: 'llm_adjudication', label: 'LLM adjudication', durKey: 'llm_adjudication_duration_ms' },
    { key: 'persist', label: 'Persist', durKey: 'persist_duration_ms' },
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

  const chipStyle = {
    backgroundColor: 'var(--estate-hover)',
    border: `1px solid ${borderColor}`,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '11px',
    borderRadius: '4px',
    padding: '4px 8px',
    color: labelColor,
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto p-6 bg-[var(--background)]" style={{ color: inkColor }}>
      {/* 1. Step Indicator strip */}
      <div className="flex items-center gap-4 mb-8 pb-4 border-b border-dashed" style={{ borderColor }}>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {step > 1 ? (
            <span style={{ color: activeColor }}>✓</span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeColor }} />
          )}
          <span style={{ color: step === 1 ? inkColor : labelColor }}>Pick object</span>
        </div>
        <div className="text-[11px]" style={{ color: borderColor }}>→</div>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {step > 2 ? (
            <span style={{ color: activeColor }}>✓</span>
          ) : step === 2 ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: activeColor }}></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: activeColor }}></span>
            </span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full border border-slate-500/40" />
          )}
          <span style={{ color: step === 2 ? inkColor : labelColor }}>Scan</span>
        </div>
        <div className="text-[11px]" style={{ color: borderColor }}>→</div>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {step === 3 ? (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: activeColor }} />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full border border-slate-500/40" />
          )}
          <span style={{ color: step === 3 ? inkColor : labelColor }}>Results</span>
        </div>
      </div>

      {/* 2. Step Views */}
      {step === 1 && (
        <div className="flex flex-col gap-6 max-w-xl">
          <h2 className="text-xs font-mono tracking-wider uppercase" style={{ fontFamily: "'IBM Plex Mono', monospace", color: labelColor }}>
            Silo Finder
          </h2>

          {/* Autocomplete Input */}
          {!selectedObject && (
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Search objects by name or description..."
                className="w-full px-4 py-3 rounded border text-xs outline-none focus:border-[#FDB515] transition-colors bg-transparent font-sans"
                style={{ borderColor, color: inkColor }}
              />

              {dropdownOpen && query.trim().length >= 2 && (
                <div
                  className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded border shadow-lg z-50 flex flex-col"
                  style={{ backgroundColor: raisedBg, borderColor }}
                >
                  {searching && (
                    <div className="p-3 text-xs font-mono" style={{ color: labelColor }}>Searching...</div>
                  )}
                  {!searching && searchResults.length === 0 && (
                    <div className="p-3 text-xs font-mono" style={{ color: labelColor }}>No matches found.</div>
                  )}
                  {!searching &&
                    searchResults.map((item) => (
                      <div
                        key={item.id}
                        onClick={async () => {
                          setDropdownOpen(false);
                          setQuery('');
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
                                });
                              }
                            }
                          } catch (err) {
                            console.error(err);
                            toast.error('Failed to load object details');
                          }
                        }}
                        className="flex items-center justify-between p-3 border-b last:border-b-0 cursor-pointer hover:bg-amber-500/5 transition-all duration-100"
                        style={{ borderColor }}
                      >
                        <span className="truncate pr-4" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: inkColor }}>
                          {item.full_path}
                        </span>
                        <span className="truncate flex-shrink-0" style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '12px', color: labelColor }}>
                          {truncateText(item.semantic_summary || 'No summary available.', 60)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Selected object card */}
          {selectedObject && (
            <div
              className="p-5 rounded border relative flex flex-col gap-2"
              style={{ backgroundColor: raisedBg, borderColor }}
            >
              <button
                onClick={handleClear}
                className="absolute top-4 right-4 text-xs font-mono text-[#FDB515] hover:underline bg-transparent border-none cursor-pointer"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
              >
                [× Clear]
              </button>

              <div className="pr-16" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', fontWeight: 'bold', color: inkColor }}>
                {selectedObject.full_path}
              </div>
              <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: labelColor, lineHeight: '1.5' }}>
                {selectedObject.summary}
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: labelColor }}>
                Rows: {selectedObject.row_count_est !== null ? Number(selectedObject.row_count_est).toLocaleString() : '—'}
              </div>
            </div>
          )}

          {/* Options Row */}
          <div className="flex flex-col gap-4 py-4 border-t border-dashed" style={{ borderColor }}>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-wider" style={{ color: labelColor, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Top N results
                </label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  step={1}
                  value={topN}
                  onChange={(e) => setTopN(Math.min(50, Math.max(5, Number(e.target.value) || 5)))}
                  className="px-3 py-2 rounded border outline-none bg-transparent"
                  style={{ borderColor, color: inkColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-wider" style={{ color: labelColor, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Min similarity
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  onChange={(e) => setMinScore(Math.min(1.0, Math.max(0.0, Number(e.target.value) || 0.0)))}
                  className="px-3 py-2 rounded border outline-none bg-transparent"
                  style={{ borderColor, color: inkColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeRejected}
                onChange={(e) => setIncludeRejected(e.target.checked)}
                className="w-3.5 h-3.5 rounded border outline-none cursor-pointer accent-[#FDB515]"
                style={{ borderColor }}
              />
              <span style={{ color: labelColor, fontFamily: "'Inter Tight', sans-serif" }}>Include previously rejected</span>
            </label>
          </div>

          {/* Action button */}
          <div className="flex flex-col gap-3 items-end">
            <button
              onClick={handleRunScan}
              disabled={!selectedObject || submitting}
              className="px-6 py-2.5 rounded text-xs font-mono tracking-wider uppercase font-semibold transition-all duration-200"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                backgroundColor: selectedObject && !submitting ? activeColor : raisedBg,
                color: selectedObject && !submitting ? '#0D1B2A' : labelColor,
                border: selectedObject && !submitting ? 'none' : `1px solid ${borderColor}`,
                cursor: selectedObject && !submitting ? 'pointer' : 'not-allowed',
                opacity: selectedObject && !submitting ? 1 : 0.5,
              }}
            >
              {submitting ? 'Starting...' : 'Scan for Similar Data →'}
            </button>

            {jobError && (
              <div className="p-3 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono w-full">
                Error: {jobError}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-6 max-w-xl">
          <h2 className="tracking-wider uppercase" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: activeColor }}>
            Scanning {selectedObject?.full_path}...
          </h2>

          <div className="p-5 rounded border flex flex-col gap-4" style={{ borderColor, backgroundColor: raisedBg }}>
            <div className="flex flex-col gap-3 text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
              {stages.map((stage, idx) => {
                const status = getStageStatus(stage.key, idx);
                const duration = jobData?.stats?.[stage.durKey];

                return (
                  <div key={stage.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {status === 'checked' ? (
                        <span style={{ color: activeColor }} className="font-bold">✓</span>
                      ) : status === 'current' ? (
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: activeColor }}></span>
                          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: activeColor }}></span>
                        </span>
                      ) : (
                        <span className="w-2 h-2 rounded-full border border-slate-500/40" />
                      )}
                      <span style={{ color: status === 'unchecked' ? labelColor : inkColor }}>
                        {stage.label}
                      </span>
                    </div>
                    {duration !== undefined && (
                      <span style={{ color: labelColor }} className="text-[10px]">
                        {(duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {jobData?.status === 'succeeded' && (
            <div className="text-xs font-mono" style={{ fontFamily: "'IBM Plex Mono', monospace", color: labelColor }}>
              {jobData.stats?.candidates_found ?? 0} candidates found above threshold · {jobData.scope?.topN ?? jobData.stats?.scanned_count ?? 15} scanned
            </div>
          )}

          {(jobError || jobData?.status === 'failed') && (
            <div className="flex flex-col gap-3 mt-4">
              <div className="p-5 rounded border border-red-500/30 bg-red-500/5 text-red-400 text-xs font-mono">
                Error: {jobError || jobData?.error || 'Job execution failed.'}
              </div>
              <button
                onClick={handleReset}
                className="text-xs font-mono text-[#FDB515] hover:underline bg-transparent border-none cursor-pointer self-start"
              >
                [← Try again]
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4 max-w-2xl">
          <h2 className="text-xs font-mono tracking-wider uppercase mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace", color: labelColor }}>
            Scan Results
          </h2>

          {loadingLinks ? (
            <div className="text-xs font-mono animate-pulse" style={{ color: labelColor }}>
              Loading results...
            </div>
          ) : links.length === 0 ? (
            <div className="flex flex-col gap-4">
              <div className="text-xs font-mono" style={{ color: labelColor }}>
                No candidates found above threshold.
              </div>
              <div>
                <button
                  onClick={handleScanAnother}
                  className="text-xs font-mono text-[#FDB515] hover:underline bg-transparent border-none cursor-pointer"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  [← Scan another object]
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Summary line */}
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: labelColor }} className="mb-2">
                {links.length} results found · {jobData?.scope?.topN ?? topN} scanned
              </div>

              {/* Cards List */}
              <div className="flex flex-col gap-3">
                {sortedLinks.map((link, index) => {
                  const candidateId = link.left_object_id === selectedObject.id ? link.right_object_id : link.left_object_id;
                  const candidateData = candidatesMap[candidateId];
                  const candidateObj = candidateData?.object;
                  const candidatePath = candidateObj?.full_path || 'Loading path...';
                  const candidateSummary = candidateData?.latestSemanticCard?.card?.summary || 'No summary available.';

                  const signals = link.signals || {};
                  const { embedCosine, columnNameOverlap, typeCompatRatio, sharedEntityTags, compositeScore } = signals;

                  // Derive overlap label
                  const candidateColumnsCount = candidateData?.columns?.length || 0;
                  const sourceColumnsCount = selectedObject?.columnsCount || 0;
                  let colOverlapLabel = '';
                  if (sourceColumnsCount > 0 && candidateColumnsCount > 0) {
                    const M = Math.max(sourceColumnsCount, candidateColumnsCount);
                    const N = Math.round(columnNameOverlap * M);
                    colOverlapLabel = `${N}/${M} col overlap`;
                  } else if (columnNameOverlap !== undefined && columnNameOverlap !== null) {
                    colOverlapLabel = `${(columnNameOverlap * 100).toFixed(0)}% col overlap`;
                  }

                  // Derive shared tag names
                  const sharedTagNames = getSharedTagNames(candidateObj, selectedObject);

                  // Schema location chip
                  const isSameSchema =
                    candidateObj?.schema_name === selectedObject?.schema_name &&
                    candidateObj?.catalog_name === selectedObject?.catalog_name &&
                    candidateObj?.source_id === selectedObject?.source_id;

                  const schemaTag = isSameSchema ? (
                    <span style={chipStyle}>
                      Same schema: {candidateObj?.schema_name || 'default'}
                    </span>
                  ) : (
                    <span style={{ ...chipStyle, backgroundColor: 'rgba(253, 181, 21, 0.15)', borderColor: activeColor, color: activeColor, fontWeight: 'bold' }}>
                      ⚠ {candidateObj?.schema_name || 'default'}
                    </span>
                  );

                  // LLM Verdict styling
                  const verdict = link.llm_verdict?.verdict;
                  const reasoning = link.llm_verdict?.reasoning;
                  let badgeStyle = { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: labelColor, borderColor };
                  let badgeText = 'UNRELATED';

                  if (verdict === 'silo') {
                    badgeStyle = { backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', borderColor: '#EF4444' };
                    badgeText = 'SILO';
                  } else if (verdict === 'duplicate') {
                    badgeStyle = { backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', borderColor: '#F59E0B' };
                    badgeText = 'DUPLICATE';
                  } else if (verdict === 'related') {
                    badgeStyle = { backgroundColor: 'rgba(96, 165, 250, 0.15)', color: '#60A5FA', borderColor: '#60A5FA' };
                    badgeText = 'RELATED';
                  } else if (verdict === 'unrelated') {
                    badgeStyle = { backgroundColor: 'rgba(255, 255, 255, 0.05)', color: labelColor, borderColor };
                    badgeText = 'UNRELATED';
                  }

                  const linkState = getLinkState(link);
                  const isConfirmed = linkState === 'confirmed' || linkState === 'confirmed_loading';
                  const isRejected = linkState === 'rejected' || linkState === 'rejected_loading';

                  return (
                    <div
                      key={link.id}
                      className={`p-4 rounded border transition-all duration-200 flex flex-col gap-3 ${isRejected ? 'opacity-50' : ''}`}
                      style={{
                        backgroundColor: isConfirmed ? 'var(--estate-active-bg)' : raisedBg,
                        borderColor: isConfirmed ? 'rgba(16, 185, 129, 0.25)' : borderColor,
                        borderRadius: '4px',
                      }}
                    >
                      {/* Top Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 truncate">
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: activeColor }} className="font-bold shrink-0">
                            #{index + 1}
                          </span>
                          <Link
                            href={`/agent-lab/estate/object/${candidateId}`}
                            className={`hover:underline hover:text-[#FDB515] transition-colors truncate font-semibold ${isRejected ? 'line-through opacity-70' : ''}`}
                            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: inkColor }}
                          >
                            {candidatePath}
                          </Link>
                        </div>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: inkColor }} className="font-bold shrink-0">
                          Score: {Number(compositeScore ?? 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Candidate Description */}
                      {candidateSummary && (
                        <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: labelColor, lineHeight: '1.5' }}>
                          {candidateSummary}
                        </div>
                      )}

                      {/* Evidence Chips Row */}
                      {signals && (
                        <div className="flex flex-wrap gap-2 items-center">
                          {colOverlapLabel && (
                            <span style={chipStyle}>
                              {colOverlapLabel}
                            </span>
                          )}

                          {embedCosine !== undefined && embedCosine !== null && (
                            <span style={chipStyle}>
                              embed {embedCosine.toFixed(2)}
                            </span>
                          )}

                          {typeCompatRatio !== undefined && typeCompatRatio !== null && (
                            <span style={chipStyle}>
                              type compat {(typeCompatRatio * 100).toFixed(0)}%
                            </span>
                          )}

                          {sharedEntityTags > 0 && (
                            <span style={chipStyle}>
                              {sharedTagNames.length > 0 ? `entity: ${sharedTagNames.join(', ')}` : `${sharedEntityTags} shared tags`}
                            </span>
                          )}

                          {schemaTag}
                        </div>
                      )}

                      {/* LLM Verdict Block */}
                      {link.llm_verdict && (
                        <div className="mt-2 p-3 rounded border flex flex-col gap-1.5" style={{ borderColor, backgroundColor: 'var(--estate-hover)' }}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-mono tracking-wider" style={{ color: labelColor }}>
                              LLM Verdict:
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded border font-semibold" style={badgeStyle}>
                              {badgeText}
                            </span>
                            {link.llm_verdict.confidence !== undefined && (
                              <span className="text-[10px] font-mono" style={{ color: labelColor }}>
                                (confidence: {Number(link.llm_verdict.confidence).toFixed(2)})
                              </span>
                            )}
                          </div>
                          {reasoning && (
                            <p style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: '13px', color: inkColor, lineHeight: '1.5' }}>
                              {reasoning}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Action / State Row */}
                      <div className="flex justify-end items-center mt-2 pt-2 border-t border-dashed" style={{ borderColor }}>
                        {linkState === 'confirmed' && (
                          <span className="text-xs font-mono font-semibold" style={{ color: '#10B981' }}>
                            Confirmed ✓
                          </span>
                        )}
                        {linkState === 'confirmed_loading' && (
                          <span className="text-xs font-mono font-semibold animate-pulse" style={{ color: '#10B981' }}>
                            Confirming...
                          </span>
                        )}
                        {linkState === 'rejected' && (
                          <span className="text-xs font-mono font-semibold" style={{ color: labelColor }}>
                            Not related
                          </span>
                        )}
                        {linkState === 'rejected_loading' && (
                          <span className="text-xs font-mono font-semibold animate-pulse" style={{ color: labelColor }}>
                            Rejecting...
                          </span>
                        )}
                        {linkState === 'proposed' && (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleRejectSilo(link.id)}
                              className="px-3 py-1.5 rounded border text-[11px] font-mono hover:bg-slate-500/10 transition-all cursor-pointer bg-transparent"
                              style={{ borderColor, color: labelColor }}
                            >
                              [✗ Not Related]
                            </button>
                            <button
                              onClick={() => handleConfirmSilo(link.id)}
                              className="px-3 py-1.5 rounded border text-[11px] font-mono hover:bg-green-500/10 transition-all cursor-pointer bg-transparent"
                              style={{ borderColor: 'rgba(16, 185, 129, 0.5)', color: '#10B981' }}
                            >
                              [✓ Confirm Silo]
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Scan another object link */}
              <div className="mt-6">
                <button
                  onClick={handleScanAnother}
                  className="text-xs font-mono text-[#FDB515] hover:underline bg-transparent border-none cursor-pointer"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  [← Scan another object]
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EstateSiloPage() {
  return (
    <Suspense fallback={<div className="p-6 font-mono text-xs text-muted-foreground">Loading Silo Finder...</div>}>
      <SiloFinderContent />
    </Suspense>
  );
}
