'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

interface Source {
  id: string;
  display_name: string | null;
  connection_kind: string;
  connection_ref: string;
  scope_include: any;
  status: string;
}

interface PickerState {
  sourceId: string;
  catalogName: string;
  schemaName: string;
}

interface MappingItem {
  id: string;
  left_column_id: string;
  right_column_id: string;
  mapping_kind: string | null;
  confidence: number | null;
  status: string;
  signals: any;
  llm_verdict: any;
  left_column: {
    id: string;
    name: string;
    object: {
      id: string;
      full_path: string;
      source_id: string;
    };
  };
  right_column: {
    id: string;
    name: string;
    object: {
      id: string;
      full_path: string;
      source_id: string;
    };
  };
}

interface AlignedMapping {
  id: string;
  leftColId: string;
  rightColId: string;
  leftColName: string;
  rightColName: string;
  mapping_kind: string | null;
  confidence: number | null;
  status: string;
  signals: any;
  llm_verdict: any;
}

interface GroupedPair {
  key: string;
  leftObjectPath: string;
  rightObjectPath: string;
  leftObjectId: string;
  rightObjectId: string;
  mappings: AlignedMapping[];
}

export default function EstateMapperPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sources, setSources] = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);

  // Picker states
  const [leftPicker, setLeftPicker] = useState<PickerState | null>(null);
  const [rightPicker, setRightPicker] = useState<PickerState | null>(null);

  const [includeRejected, setIncludeRejected] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Polling states for Step 2
  const [jobData, setJobData] = useState<any>(null);

  // Mappings & object column states for Step 3
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [objectColumns, setObjectColumns] = useState<Record<string, any[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedRemainder, setExpandedRemainder] = useState<Record<string, boolean>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [bulkConfirming, setBulkConfirming] = useState<Record<string, string>>({});

  // Style tokens
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const raisedBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';
  const activeColor = '#FDB515';

  // Load sources on mount
  useEffect(() => {
    async function loadSources() {
      try {
        setLoadingSources(true);
        const res = await fetch('/api/agent-lab/context/sources');
        if (res.ok) {
          const json = await res.json();
          setSources(json.sources || []);
        }
      } catch (err) {
        console.error('Failed to load sources:', err);
      } finally {
        setLoadingSources(false);
      }
    }
    void loadSources();
  }, []);

  // Compute path globs for identical-pair checks
  const leftGlob = leftPicker?.catalogName && leftPicker?.schemaName 
    ? `${leftPicker.catalogName}.${leftPicker.schemaName}.*`
    : '';
  const rightGlob = rightPicker?.catalogName && rightPicker?.schemaName
    ? `${rightPicker.catalogName}.${rightPicker.schemaName}.*`
    : '';

  const isIdenticalPair = leftPicker && rightPicker &&
    leftPicker.sourceId === rightPicker.sourceId &&
    leftGlob === rightGlob;

  const canRun = leftPicker?.sourceId && leftPicker?.catalogName && leftPicker?.schemaName &&
    rightPicker?.sourceId && rightPicker?.catalogName && rightPicker?.schemaName &&
    !isIdenticalPair && !submitting;

  const handleRunMapping = async () => {
    if (!canRun) return;

    setSubmitting(true);
    setJobError(null);

    try {
      const payload = {
        left: { sourceId: leftPicker.sourceId, pathGlob: leftGlob },
        right: { sourceId: rightPicker.sourceId, pathGlob: rightGlob },
        includeRejected,
      };

      const res = await fetch('/api/agent-lab/context/mappings/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to start mapping job.');
      }

      const json = await res.json();
      setJobId(json.job_id);

      // CORRECTION 1 / D-24: Only fire process synchronously in development env
      if (process.env.NODE_ENV === 'development') {
        void fetch('/api/agent-lab/context/process', { method: 'POST' }).catch(() => {});
      }

      setStep(2);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Unknown error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  // STEP 2: Job details polling
  useEffect(() => {
    if (step !== 2 || !jobId) return;

    let intervalId: NodeJS.Timeout;

    const pollJob = async () => {
      try {
        const res = await fetch(`/api/agent-lab/context/jobs/${jobId}`);
        if (!res.ok) return;

        const json = await res.json();
        const job = json.data;
        setJobData(job);

        if (job.status === 'succeeded' || job.status === 'done') {
          clearInterval(intervalId);
          setStep(3);
        } else if (job.status === 'failed') {
          clearInterval(intervalId);
          setJobError(job.error || 'Mapping job failed.');
        }
      } catch (err) {
        console.error('Error polling job:', err);
      }
    };

    void pollJob();
    intervalId = setInterval(pollJob, 3000);

    return () => clearInterval(intervalId);
  }, [step, jobId]);

  // STEP 3: Load mappings and resolve columns
  useEffect(() => {
    if (step !== 3 || !leftPicker || !rightPicker) return;

    async function loadMappings() {
      setLoadingMappings(true);
      try {
        // Cap to pageSize=500
        const res = await fetch(
          `/api/agent-lab/context/mappings?sourceId=${leftPicker!.sourceId}&pageSize=500`
        );
        if (res.ok) {
          const json = await res.json();
          setMappings(json.data?.items || []);
        }
      } catch (err) {
        console.error('Failed to load mappings:', err);
        toast.error('Failed to load mappings results.');
      } finally {
        setLoadingMappings(false);
      }
    }
    void loadMappings();
  }, [step, leftPicker, rightPicker]);

  // Glob matching helper
  function matchGlob(path: string, glob: string): boolean {
    if (!glob || glob === '*') return true;
    if (glob.endsWith('.*')) {
      const prefix = glob.slice(0, -2);
      return path === prefix || path.startsWith(prefix + '.');
    }
    return path === glob;
  }

  // Filter and Group Mappings
  const filteredMappings = mappings.filter((m) => {
    const lCol = m.left_column;
    const rCol = m.right_column;
    if (!lCol || !rCol || !lCol.object || !rCol.object) return false;

    const leftSource = leftPicker!.sourceId;
    const rightSource = rightPicker!.sourceId;

    const matchesSourceOrder = lCol.object.source_id === leftSource && rCol.object.source_id === rightSource;
    const matchesSourceSwapped = lCol.object.source_id === rightSource && rCol.object.source_id === leftSource;

    if (!matchesSourceOrder && !matchesSourceSwapped) return false;

    const mappedLeftCol = matchesSourceOrder ? lCol : rCol;
    const mappedRightCol = matchesSourceOrder ? rCol : lCol;

    const leftMatch = matchGlob(mappedLeftCol.object.full_path, leftGlob);
    const rightMatch = matchGlob(mappedRightCol.object.full_path, rightGlob);

    return leftMatch && rightMatch;
  });

  const groupedPairs: GroupedPair[] = [];
  const groupedMap = new Map<string, AlignedMapping[]>();

  for (const m of filteredMappings) {
    const lCol = m.left_column;
    const rCol = m.right_column;
    const isSwapped = lCol.object.source_id === rightPicker!.sourceId;

    const mappedLeftCol = isSwapped ? rCol : lCol;
    const mappedRightCol = isSwapped ? lCol : rCol;

    const key = `${mappedLeftCol.object.id}:${mappedRightCol.object.id}`;

    const aligned: AlignedMapping = {
      id: m.id,
      leftColId: mappedLeftCol.id,
      rightColId: mappedRightCol.id,
      leftColName: mappedLeftCol.name,
      rightColName: mappedRightCol.name,
      mapping_kind: m.mapping_kind,
      confidence: m.confidence,
      status: m.status,
      signals: m.signals,
      llm_verdict: m.llm_verdict,
    };

    if (!groupedMap.has(key)) {
      groupedMap.set(key, []);
      groupedPairs.push({
        key,
        leftObjectPath: mappedLeftCol.object.full_path,
        rightObjectPath: mappedRightCol.object.full_path,
        leftObjectId: mappedLeftCol.object.id,
        rightObjectId: mappedRightCol.object.id,
        mappings: groupedMap.get(key)!,
      });
    }
    groupedMap.get(key)!.push(aligned);
  }

  // Load objects columns for unmapped panel when Step 3 mounts
  const uniqueObjectIds = Array.from(
    new Set(groupedPairs.flatMap((g) => [g.leftObjectId, g.rightObjectId]))
  );

  useEffect(() => {
    if (step !== 3 || uniqueObjectIds.length === 0) return;

    async function loadObjectDetails() {
      const details: Record<string, any[]> = {};
      try {
        await Promise.all(
          uniqueObjectIds.map(async (id) => {
            const res = await fetch(`/api/agent-lab/context/objects/${id}`);
            if (res.ok) {
              const json = await res.json();
              details[id] = json.data?.columns || [];
            }
          })
        );
        setObjectColumns(details);
      } catch (err) {
        console.error('Failed to load object columns for remainder panel:', err);
      }
    }
    void loadObjectDetails();
  }, [step, uniqueObjectIds.join(',')]);

  // Confirm/Reject single mappings
  const handleUpdateStatus = async (mappingId: string, status: 'confirmed' | 'rejected') => {
    // 1. Optimistic update
    const prevMappings = [...mappings];
    setMappings((prev) =>
      prev.map((m) => (m.id === mappingId ? { ...m, status } : m))
    );

    try {
      const res = await fetch(`/api/agent-lab/context/mappings/${mappingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        throw new Error('PATCH failed');
      }
    } catch (err) {
      // Revert optimistic update
      setMappings(prevMappings);
      toast.error('Failed to update mapping — please try again');
    }
  };

  // Bulk confirm series queue helper
  const handleBulkConfirm = async (group: GroupedPair) => {
    const key = group.key;
    const rawThreshold = thresholds[key] || '0.85';
    const threshold = parseFloat(rawThreshold) || 0.85;

    const toConfirm = group.mappings.filter(
      (m) => m.status === 'proposed' && (m.confidence ?? 0) >= threshold
    );

    if (toConfirm.length === 0) {
      toast.info('No proposed mappings match the threshold');
      return;
    }

    setBulkConfirming((prev) => ({ ...prev, [key]: `Confirming 0/${toConfirm.length}...` }));

    let count = 0;
    for (const m of toConfirm) {
      try {
        count++;
        setBulkConfirming((prev) => ({
          ...prev,
          [key]: `Confirming ${count}/${toConfirm.length}...`,
        }));

        // Optimistic UI for each one
        setMappings((prev) =>
          prev.map((orig) => (orig.id === m.id ? { ...orig, status: 'confirmed' } : orig))
        );

        const res = await fetch(`/api/agent-lab/context/mappings/${m.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'confirmed' }),
        });

        if (!res.ok) {
          throw new Error('Bulk confirm failed at mapping ' + m.id);
        }
      } catch (err) {
        console.error(err);
        toast.error(`Failed to confirm mapping row`);
        // Stop sequential queue on error to reconcile
        break;
      }
    }

    setBulkConfirming((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
    toast.success(`Bulk confirmation complete (${count} mappings confirmed)`);
  };

  // Polling stages details for Step 2
  const currentStage = jobData?.stats?.stage || 'candidate_generation';
  const isJobSucceeded = jobData?.status === 'succeeded' || jobData?.status === 'done';

  const stages = [
    { key: 'candidate_generation', label: 'Candidate generation', durKey: 'candidate_generation_duration_ms' },
    { key: 'value_overlap', label: 'Value overlap (Jaccard)', durKey: 'value_overlap_duration_ms' },
    { key: 'llm_adjudication', label: 'LLM adjudication', durKey: 'llm_adjudication_duration_ms' },
    { key: 'persist', label: 'Persist', durKey: 'persist_duration_ms' },
  ];

  const getStageStatus = (stageKey: string, index: number) => {
    if (isJobSucceeded) return 'checked';
    const activeIndex = stages.findIndex((s) => s.key === currentStage);
    if (activeIndex === -1) return 'unchecked';

    if (index < activeIndex) return 'checked';
    if (index === activeIndex) return 'current';
    return 'unchecked';
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto p-6" style={{ color: inkColor }}>
      {/* 1. Step indicator strip */}
      <div className="flex items-center gap-8 mb-8 pb-4 border-b border-dashed" style={{ borderColor }}>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold">
          {step > 1 ? (
            <span style={{ color: activeColor }}>✓</span>
          ) : (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeColor }} />
          )}
          <span style={{ color: step === 1 ? activeColor : labelColor }}>Pick pair</span>
        </div>
        <div style={{ color: borderColor }}>→</div>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold">
          {step > 2 ? (
            <span style={{ color: activeColor }}>✓</span>
          ) : step === 2 ? (
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: activeColor }} />
          ) : (
            <span className="w-2 h-2 rounded-full border" style={{ borderColor: labelColor }} />
          )}
          <span style={{ color: step === 2 ? activeColor : labelColor }}>Run</span>
        </div>
        <div style={{ color: borderColor }}>→</div>
        <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase font-semibold">
          {step === 3 ? (
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeColor }} />
          ) : (
            <span className="w-2 h-2 rounded-full border" style={{ borderColor: labelColor }} />
          )}
          <span style={{ color: step === 3 ? activeColor : labelColor }}>Review</span>
        </div>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-6 max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Picker */}
            <SchemaPicker
              title="Left Schema"
              sources={sources}
              value={leftPicker}
              onChange={setLeftPicker}
              borderColor={borderColor}
              raisedBg={raisedBg}
              inkColor={inkColor}
              labelColor={labelColor}
            />

            {/* Right Picker */}
            <SchemaPicker
              title="Right Schema"
              sources={sources}
              value={rightPicker}
              onChange={setRightPicker}
              borderColor={borderColor}
              raisedBg={raisedBg}
              inkColor={inkColor}
              labelColor={labelColor}
            />
          </div>

          {/* Warnings & identical guard */}
          {isIdenticalPair && (
            <div className="text-red-500 text-xs font-mono font-semibold">
              Cannot map a schema to itself
            </div>
          )}

          {jobError && (
            <div className="p-3 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
              Error: {jobError}
            </div>
          )}

          {/* Run config row */}
          <div className="flex items-center gap-3 py-4 border-t border-dashed" style={{ borderColor }}>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeRejected}
                onChange={(e) => setIncludeRejected(e.target.checked)}
                className="w-3.5 h-3.5 rounded border outline-none cursor-pointer accent-[#FDB515]"
                style={{ borderColor }}
              />
              <span style={{ color: labelColor }}>Include previously rejected mappings</span>
            </label>
          </div>

          {/* Action button */}
          <div className="flex justify-end mt-4">
            <button
              onClick={handleRunMapping}
              disabled={!canRun}
              className="px-6 py-2.5 rounded text-xs font-mono tracking-wider uppercase font-semibold transition-all duration-200"
              style={{
                backgroundColor: canRun ? activeColor : raisedBg,
                color: canRun ? '#0D1B2A' : labelColor,
                border: canRun ? 'none' : `1px solid ${borderColor}`,
                cursor: canRun ? 'pointer' : 'not-allowed',
                opacity: canRun ? 1 : 0.5,
              }}
            >
              {submitting ? 'Starting...' : 'Run Mapping →'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-6 max-w-xl">
          <h2 className="text-sm font-mono tracking-wider uppercase">Job Execution</h2>
          
          <div className="p-5 rounded border flex flex-col gap-4" style={{ borderColor, backgroundColor: raisedBg }}>
            <div className="flex flex-col gap-3 font-mono text-xs">
              {stages.map((stage, idx) => {
                const status = getStageStatus(stage.key, idx);
                const duration = jobData?.stats?.[stage.durKey];
                
                return (
                  <div key={stage.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {status === 'checked' ? (
                        <span style={{ color: activeColor }} className="font-bold">✓</span>
                      ) : status === 'current' ? (
                        <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: activeColor }} />
                      ) : (
                        <span className="w-2 h-2 rounded-full border" style={{ borderColor: labelColor }} />
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

          {jobError && (
            <div className="flex flex-col gap-3">
              <div className="p-3 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-mono">
                Error: {jobError}
              </div>
              <button
                onClick={() => {
                  setStep(1);
                  setJobId(null);
                  setJobError(null);
                  setJobData(null);
                }}
                className="px-4 py-2 border rounded self-start text-xs font-mono uppercase tracking-wider hover:border-[#FDB515] transition-colors"
                style={{ borderColor, color: inkColor }}
              >
                ← Try again
              </button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-6 max-w-5xl">
          <div className="flex justify-between items-center pb-2 border-b" style={{ borderColor }}>
            <h2 className="text-sm font-mono tracking-wider uppercase">Mapping Review</h2>
            <Link
              href="/api/agent-lab/context/mappings/export?format=md"
              download
              className="px-4 py-1.5 border rounded text-xs font-mono uppercase tracking-wider hover:border-[#FDB515] transition-all"
              style={{ borderColor, color: inkColor }}
            >
              Export as Markdown ↓
            </Link>
          </div>

          {loadingMappings ? (
            <div className="text-xs font-mono animate-pulse" style={{ color: labelColor }}>
              Loading mappings results...
            </div>
          ) : groupedPairs.length === 0 ? (
            <div className="text-xs font-mono" style={{ color: labelColor }}>
              No proposed mappings found between the selected schemas.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groupedPairs.map((group) => {
                const isExpanded = expandedGroups[group.key] !== false;
                const isRemainderExpanded = expandedRemainder[group.key] === true;
                const threshold = thresholds[group.key] || '0.85';
                const confirmingState = bulkConfirming[group.key];

                // Calculate group stats
                const scores = group.mappings.map((m) => m.confidence ?? 0);
                const avgConf = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : '0.000';

                return (
                  <div key={group.key} className="border rounded flex flex-col overflow-hidden" style={{ borderColor, backgroundColor: raisedBg }}>
                    {/* Group Header */}
                    <div
                      className="flex items-center justify-between px-4 py-3 border-b cursor-pointer select-none"
                      style={{ borderColor, backgroundColor: 'var(--estate-bg)' }}
                      onClick={() =>
                        setExpandedGroups((prev) => ({ ...prev, [group.key]: !isExpanded }))
                      }
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs font-bold">
                            {group.leftObjectPath} ↔ {group.rightObjectPath}
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: labelColor }}>
                            avg confidence: {avgConf} · {group.mappings.length} column mappings
                          </span>
                        </div>
                      </div>

                      {/* Bulk actions */}
                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono" style={{ color: labelColor }}>
                            Bulk confirm ≥
                          </span>
                          <input
                            type="number"
                            step="0.05"
                            min="0.0"
                            max="1.0"
                            value={threshold}
                            onChange={(e) =>
                              setThresholds((prev) => ({ ...prev, [group.key]: e.target.value }))
                            }
                            className="w-12 h-6 border rounded px-1 text-xs font-mono outline-none text-center bg-transparent"
                            style={{ borderColor, color: inkColor }}
                          />
                        </div>
                        <button
                          disabled={!!confirmingState}
                          onClick={() => handleBulkConfirm(group)}
                          className="px-3 py-1 bg-[#FDB515] text-[#0D1B2A] rounded text-[10px] font-mono font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
                        >
                          {confirmingState || 'Confirm'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="flex flex-col">
                        {/* Rows */}
                        <div className="flex flex-col divide-y transition-colors duration-200" style={{ borderColor }}>
                          {group.mappings.map((m) => {
                            const isConfirmed = m.status === 'confirmed';
                            const isRejected = m.status === 'rejected';

                            const signals = (m.signals || {}) as Record<string, any>;
                            const embedVal = signals.embed_sim ?? 0;
                            const nameVal = signals.name_sim ?? 0;
                            const typeVal = signals.type_compat ?? 0;
                            const jaccardVal = signals.value_overlap_jaccard ?? 0;

                            const verdict = (m.llm_verdict || {}) as Record<string, any>;
                            const rationale = verdict.rationale || verdict.verdict || '';
                            const truncRationale = rationale.length > 80 ? rationale.slice(0, 77) + '...' : rationale;

                            return (
                              <div
                                key={m.id}
                                className={`grid grid-cols-1 md:grid-cols-12 gap-4 px-4 py-3 items-center text-xs transition-all duration-200 ${
                                  isConfirmed ? 'bg-green-500/5' : isRejected ? 'opacity-40' : ''
                                }`}
                              >
                                {/* Aligned Column names */}
                                <div className="col-span-3 font-mono font-semibold flex flex-wrap items-center gap-1.5">
                                  <span className={isRejected ? 'line-through' : ''}>{m.leftColName}</span>
                                  <span style={{ color: labelColor }}>↔</span>
                                  <span className={isRejected ? 'line-through' : ''}>{m.rightColName}</span>
                                </div>

                                {/* Signals bars */}
                                <div className="col-span-3 flex items-center gap-3">
                                  <div className="flex flex-col gap-1 w-full">
                                    <div className="grid grid-cols-4 gap-1 text-[8px] font-mono text-center" style={{ color: labelColor }}>
                                      <div>EMB</div>
                                      <div>NAM</div>
                                      <div>TYP</div>
                                      <div>JAC</div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                      {/* Embed */}
                                      <div className="h-1 bg-gray-500/20 rounded overflow-hidden">
                                        <div className="h-full bg-[#FDB515]" style={{ width: `${embedVal * 100}%` }} />
                                      </div>
                                      {/* Name */}
                                      <div className="h-1 bg-gray-500/20 rounded overflow-hidden">
                                        <div className="h-full bg-[#FDB515]" style={{ width: `${nameVal * 100}%` }} />
                                      </div>
                                      {/* Type */}
                                      <div className="h-1 bg-gray-500/20 rounded overflow-hidden">
                                        <div className="h-full bg-[#FDB515]" style={{ width: `${typeVal * 100}%` }} />
                                      </div>
                                      {/* Jaccard */}
                                      <div className="h-1 bg-gray-500/20 rounded overflow-hidden">
                                        <div className="h-full bg-[#FDB515]" style={{ width: `${jaccardVal * 100}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Rationale */}
                                <div
                                  className="col-span-3 text-[11px] truncate select-none"
                                  style={{ color: labelColor }}
                                  title={rationale}
                                >
                                  {truncRationale}
                                </div>

                                {/* Confidence */}
                                <div className="col-span-1 font-mono text-center font-bold">
                                  {(m.confidence ?? 0).toFixed(3)}
                                </div>

                                {/* Action buttons */}
                                <div className="col-span-2 flex justify-end items-center gap-2">
                                  {isConfirmed ? (
                                    <span className="text-green-500 font-mono font-semibold">Confirmed ✓</span>
                                  ) : isRejected ? (
                                    <span style={{ color: labelColor }} className="font-mono">Rejected</span>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => handleUpdateStatus(m.id, 'confirmed')}
                                        className="px-2.5 py-1 rounded border border-green-500/30 text-green-500 hover:bg-green-500/10 text-[10px] font-mono uppercase font-semibold"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        onClick={() => handleUpdateStatus(m.id, 'rejected')}
                                        className="px-2.5 py-1 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 text-[10px] font-mono uppercase font-semibold"
                                      >
                                        Reject
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Collapsible Unmapped Remainder Panel */}
                        <div className="border-t p-3" style={{ borderColor }}>
                          <div
                            className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider font-semibold cursor-pointer select-none"
                            style={{ color: labelColor }}
                            onClick={() =>
                              setExpandedRemainder((prev) => ({ ...prev, [group.key]: !isRemainderExpanded }))
                            }
                          >
                            <span>{isRemainderExpanded ? '▼' : '▶'}</span>
                            <span>Unmapped columns remainder</span>
                          </div>

                          {isRemainderExpanded && (
                            <div className="mt-2.5 flex flex-col gap-2 pl-4 text-[11px] font-mono">
                              {(() => {
                                const leftAll = objectColumns[group.leftObjectId]?.map((c) => c.name) || [];
                                const leftMapped = new Set(group.mappings.map((m) => m.leftColName));
                                const leftUnmapped = leftAll.filter((name) => !leftMapped.has(name));

                                const rightAll = objectColumns[group.rightObjectId]?.map((c) => c.name) || [];
                                const rightMapped = new Set(group.mappings.map((m) => m.rightColName));
                                const rightUnmapped = rightAll.filter((name) => !rightMapped.has(name));

                                return (
                                  <>
                                    <div>
                                      <span className="font-bold">Left unmapped ({leftUnmapped.length}):</span>{' '}
                                      {leftUnmapped.length > 0 ? leftUnmapped.join(', ') : 'none'}
                                    </div>
                                    <div>
                                      <span className="font-bold">Right unmapped ({rightUnmapped.length}):</span>{' '}
                                      {rightUnmapped.length > 0 ? rightUnmapped.join(', ') : 'none'}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// extracted SchemaPicker component
interface SchemaPickerProps {
  title: string;
  sources: Source[];
  value: PickerState | null;
  onChange: (val: PickerState | null) => void;
  borderColor: string;
  raisedBg: string;
  inkColor: string;
  labelColor: string;
}

function SchemaPicker({
  title,
  sources,
  value,
  onChange,
  borderColor,
  raisedBg,
  inkColor,
  labelColor,
}: SchemaPickerProps) {
  const activeColor = '#FDB515';
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  // Coverage statistics
  const [totalObjects, setTotalObjects] = useState<number | null>(null);
  const [enrichedObjects, setEnrichedObjects] = useState<number | null>(null);
  const [loadingCoverage, setLoadingCoverage] = useState(false);

  // Dropdown style
  const selectStyle: React.CSSProperties = {
    fontFamily: "'Inter Tight', sans-serif",
    fontSize: '12px',
    backgroundColor: raisedBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '4px',
    color: inkColor,
    padding: '8px 24px 8px 12px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%238892A4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    width: '100%',
  };

  const handleSourceChange = async (sourceId: string) => {
    if (!sourceId) {
      onChange(null);
      setCatalogs([]);
      setSchemas([]);
      return;
    }

    onChange({ sourceId, catalogName: '', schemaName: '' });
    setCatalogs([]);
    setSchemas([]);
    setTotalObjects(null);
    setEnrichedObjects(null);
    setLoadingCatalogs(true);

    try {
      const res = await fetch(`/api/agent-lab/context/objects?sourceId=${sourceId}&pageSize=200`);
      if (res.ok) {
        const json = await res.json();
        const items = json.data?.items || [];
        const uniqueCatalogs = Array.from(
          new Set(items.map((item: any) => item.catalog_name || 'hive_metastore'))
        ) as string[];
        uniqueCatalogs.sort((a, b) => a.localeCompare(b));
        setCatalogs(uniqueCatalogs);
      }
    } catch (err) {
      console.error('Error fetching catalogs:', err);
    } finally {
      setLoadingCatalogs(false);
    }
  };

  const handleCatalogChange = async (catalogName: string) => {
    if (!value?.sourceId) return;

    onChange({ ...value, catalogName, schemaName: '' });
    setSchemas([]);
    setTotalObjects(null);
    setEnrichedObjects(null);
    setLoadingSchemas(true);

    try {
      const res = await fetch(
        `/api/agent-lab/context/objects?sourceId=${value.sourceId}&catalog=${catalogName}&pageSize=200`
      );
      if (res.ok) {
        const json = await res.json();
        const items = json.data?.items || [];
        const uniqueSchemas = Array.from(
          new Set(items.map((item: any) => item.schema_name || 'default'))
        ) as string[];
        uniqueSchemas.sort((a, b) => a.localeCompare(b));
        setSchemas(uniqueSchemas);
      }
    } catch (err) {
      console.error('Error fetching schemas:', err);
    } finally {
      setLoadingSchemas(false);
    }
  };

  const handleSchemaChange = (schemaName: string) => {
    if (!value) return;
    onChange({ ...value, schemaName });
  };

  // Fetch coverage stats
  useEffect(() => {
    if (!value?.sourceId || !value?.catalogName || !value?.schemaName) {
      setTotalObjects(null);
      setEnrichedObjects(null);
      return;
    }

    async function fetchCoverage() {
      setLoadingCoverage(true);
      try {
        const [objRes, covRes] = await Promise.all([
          fetch(
            `/api/agent-lab/context/objects?sourceId=${value!.sourceId}&catalog=${value!.catalogName}&schema=${value!.schemaName}&pageSize=1`
          ),
          fetch(`/api/agent-lab/context/sources/${value!.sourceId}/coverage`),
        ]);

        let total = 0;
        if (objRes.ok) {
          const objJson = await objRes.json();
          total = objJson.data?.total ?? 0;
          setTotalObjects(total);
        }

        if (covRes.ok) {
          const covJson = await covRes.json();
          const sourceEnriched = covJson.data?.enriched ?? 0;
          // Cap enriched count to total to prevent mismatched totals
          setEnrichedObjects(Math.min(sourceEnriched, total));
        }
      } catch (err) {
        console.error('Failed to load coverage stats:', err);
      } finally {
        setLoadingCoverage(false);
      }
    }

    void fetchCoverage();
  }, [value?.sourceId, value?.catalogName, value?.schemaName]);

  return (
    <div className="flex flex-col gap-4 p-4 rounded border" style={{ borderColor, backgroundColor: raisedBg }}>
      <h3 className="text-xs font-mono uppercase tracking-wider font-semibold" style={{ color: activeColor }}>
        {title}
      </h3>

      <div className="flex flex-col gap-3">
        {/* 1. Source selector */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-semibold font-mono" style={{ color: labelColor }}>
            Source
          </label>
          <select
            style={selectStyle}
            value={value?.sourceId || ''}
            onChange={(e) => handleSourceChange(e.target.value)}
          >
            <option value="">Select source...</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name || s.connection_kind} ({s.status})
              </option>
            ))}
          </select>
        </div>

        {/* 2. Catalog selector */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-semibold font-mono" style={{ color: labelColor }}>
            Catalog
          </label>
          <select
            style={selectStyle}
            disabled={!value?.sourceId || loadingCatalogs}
            value={value?.catalogName || ''}
            onChange={(e) => handleCatalogChange(e.target.value)}
          >
            <option value="">
              {loadingCatalogs ? 'Loading catalogs...' : 'Select catalog...'}
            </option>
            {catalogs.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Schema selector */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase font-semibold font-mono" style={{ color: labelColor }}>
            Schema
          </label>
          <select
            style={selectStyle}
            disabled={!value?.catalogName || loadingSchemas}
            value={value?.schemaName || ''}
            onChange={(e) => handleSchemaChange(e.target.value)}
          >
            <option value="">
              {loadingSchemas ? 'Loading schemas...' : 'Select schema...'}
            </option>
            {schemas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Coverage summaries */}
      {value?.sourceId && value?.catalogName && value?.schemaName && (
        <div className="mt-2 pt-2 border-t text-[11px] font-mono" style={{ borderColor }}>
          {loadingCoverage ? (
            <span style={{ color: labelColor }} className="animate-pulse">Loading coverage stats...</span>
          ) : (
            <div className="flex flex-col gap-1">
              <div>
                {totalObjects ?? 0} objects · {enrichedObjects ?? 0} enriched{' '}
                {enrichedObjects === totalObjects ? (
                  <span className="text-green-500 font-bold">✓</span>
                ) : (
                  <span className="text-amber-500 font-bold">⚠</span>
                )}
              </div>
              {totalObjects !== null && enrichedObjects !== null && enrichedObjects < totalObjects && (
                <div className="text-amber-500 mt-1">
                  ⚠ {totalObjects - enrichedObjects} objects not enriched — mapping quality may be reduced.{' '}
                  <Link href="/agent-lab/estate/catalog" className="underline hover:text-[#FDB515] transition-colors">
                    [Enrich now →]
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
