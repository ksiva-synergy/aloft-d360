'use client';

import { Select } from '@/components/form/Select';
import React, { useState, useEffect } from 'react';
import Link from '@/lib/navigation/link';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  SearchX,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CATALOG_BTN,
  CATALOG_BTN_PRIMARY,
  CATALOG_SELECT,
  CATALOG_SELECT_ARROW,
  ObjectNameCell,
  formatCompactCount,
} from '@/components/estate/catalog-ui';
import {
  CARD,
  ConfidenceBar,
  ErrorNotice,
  FieldLabel,
  MapperStepper,
  MappingStatusPill,
  StageList,
  formatPct,
  type StageRow,
} from '@/components/estate/mapper/mapper-ui';
import { useCanRunEstatePipeline } from '@/lib/estate/useEstatePipelineAccess';

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
  const canAct = useCanRunEstatePipeline();
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
    { key: 'candidate_generation', label: 'Find candidates', hint: 'Pair up columns with similar names, types and meaning', durKey: 'candidate_generation_duration_ms' },
    { key: 'value_overlap', label: 'Compare values', hint: 'Check how many sample values the columns share', durKey: 'value_overlap_duration_ms' },
    { key: 'llm_adjudication', label: 'AI review', hint: 'Score each likely match and explain why', durKey: 'llm_adjudication_duration_ms' },
    { key: 'persist', label: 'Save results', hint: 'Store the suggested matches for review', durKey: 'persist_duration_ms' },
  ];

  const getStageStatus = (stageKey: string, index: number) => {
    if (isJobSucceeded) return 'checked';
    const activeIndex = stages.findIndex((s) => s.key === currentStage);
    if (activeIndex === -1) return 'unchecked';

    if (index < activeIndex) return 'checked';
    if (index === activeIndex) return 'current';
    return 'unchecked';
  };

  const sourceName = (id: string | undefined) => {
    const s = sources.find((x) => x.id === id);
    return s ? s.display_name || s.connection_kind : '';
  };
  const schemaLabel = (p: PickerState | null) => (p ? `${p.catalogName}.${p.schemaName}` : '');

  const stageRows: StageRow[] = stages.map((stage, idx) => ({
    key: stage.key,
    label: stage.label,
    hint: stage.hint,
    status: getStageStatus(stage.key, idx) as StageRow['status'],
    durationMs: jobData?.stats?.[stage.durKey],
  }));

  const allAligned = groupedPairs.flatMap((g) => g.mappings);
  const confirmedCount = allAligned.filter((m) => m.status === 'confirmed').length;
  const toReviewCount = allAligned.filter((m) => m.status === 'proposed').length;

  const resetToStart = () => {
    setStep(1);
    setJobId(null);
    setJobError(null);
    setJobData(null);
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-[var(--estate-ink)]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-3">
            <MapperStepper step={step} />
          </div>
          {step === 3 && (
            <Link
              href="/api/agent-lab/context/mappings/export?format=md"
              download
              className={cn(CATALOG_BTN, 'h-8')}
            >
              <Download className="size-3.5" />
              Export as Markdown
            </Link>
          )}
        </header>

        {/* STEP 1 — choose schemas */}
        {step === 1 && (
          <section className="flex flex-col gap-4">
            <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <SchemaPicker
                badge="A"
                title="First schema"
                sources={sources}
                loadingSources={loadingSources}
                value={leftPicker}
                onChange={setLeftPicker}
              />
              <div className="flex items-center justify-center" aria-hidden>
                <span className="flex size-8 items-center justify-center rounded-full border border-[var(--estate-border)] bg-[var(--estate-surface)] text-[var(--estate-text-muted)]">
                  <ArrowLeftRight className="size-4" />
                </span>
              </div>
              <SchemaPicker
                badge="B"
                title="Second schema"
                sources={sources}
                loadingSources={loadingSources}
                value={rightPicker}
                onChange={setRightPicker}
              />
            </div>

            {isIdenticalPair && <ErrorNotice>Pick two different schemas to compare.</ErrorNotice>}
            {jobError && <ErrorNotice>{jobError}</ErrorNotice>}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--estate-border)] pt-4">
              <label className="flex cursor-pointer select-none items-center gap-2 text-ui-regular text-[var(--estate-text-secondary)]">
                <input
                  type="checkbox"
                  checked={includeRejected}
                  onChange={(e) => setIncludeRejected(e.target.checked)}
                  className="size-3.5 cursor-pointer accent-[var(--brand-a)]"
                />
                Include matches I rejected before
              </label>
              <button type="button" onClick={handleRunMapping} disabled={!canRun || !canAct} title={canAct ? undefined : 'Only platform admins can run mappings'} className={CATALOG_BTN_PRIMARY}>
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Starting{'\u2026'}
                  </>
                ) : (
                  <>
                    Find matching columns
                    <ArrowRight className="size-3.5" />
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* STEP 2 — matching in progress */}
        {step === 2 && (
          <section className={cn(CARD, 'w-full max-w-[640px]')}>
            <div className="flex items-start gap-3 border-b border-[var(--estate-border)] px-5 py-4">
              {jobError ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--bad)]" />
              ) : (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[var(--brand-a)]" />
              )}
              <div className="min-w-0">
                <h2 className="text-title-card text-[var(--estate-ink)]">
                  {jobError ? 'Matching stopped' : 'Finding matching columns'}
                </h2>
                <p className="mt-0.5 text-caption text-[var(--estate-text-muted)]">
                  Comparing <span className="font-mono">{schemaLabel(leftPicker)}</span>
                  {' \u2192 '}
                  <span className="font-mono">{schemaLabel(rightPicker)}</span>
                  {!jobError && '. This page updates on its own.'}
                </p>
              </div>
            </div>
            <div className="px-5 py-4">
              <StageList stages={stageRows} />
            </div>
            {jobError && (
              <div className="flex flex-col gap-3 border-t border-[var(--estate-border)] px-5 py-4">
                <ErrorNotice>{jobError}</ErrorNotice>
                <button type="button" onClick={resetToStart} className={cn(CATALOG_BTN, 'self-start')}>
                  <ArrowLeft className="size-3.5" />
                  Try again
                </button>
              </div>
            )}
          </section>
        )}

        {/* STEP 3 — review */}
        {step === 3 && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <div className="min-w-0 text-ui-regular text-[var(--estate-text-secondary)]">
                <span className="text-[var(--estate-text-muted)]">{sourceName(leftPicker?.sourceId)}</span>{' '}
                <span className="font-mono text-[var(--estate-ink)]">{schemaLabel(leftPicker)}</span>
                <ArrowRight className="mx-2 inline size-3.5 align-[-2px] text-[var(--estate-text-dim)]" />
                <span className="text-[var(--estate-text-muted)]">{sourceName(rightPicker?.sourceId)}</span>{' '}
                <span className="font-mono text-[var(--estate-ink)]">{schemaLabel(rightPicker)}</span>
              </div>
              {!loadingMappings && groupedPairs.length > 0 && (
                <div className="text-ui-regular tabular-nums text-[var(--estate-text-muted)]">
                  <span className="text-[var(--estate-ink)]">{groupedPairs.length}</span>{' '}
                  {groupedPairs.length === 1 ? 'table pair' : 'table pairs'}
                  {' \u00b7 '}
                  <span className="text-[var(--estate-ink)]">{allAligned.length}</span> suggested matches
                  {' \u00b7 '}
                  <span className="text-[var(--ok)]">{confirmedCount}</span> confirmed
                  {' \u00b7 '}
                  <span className="text-[var(--estate-ink)]">{toReviewCount}</span> to review
                </div>
              )}
            </div>

            {loadingMappings ? (
              <div className={cn(CARD, 'flex flex-col gap-3 p-5')} aria-busy>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded-ctl bg-[var(--estate-hover)]" />
                ))}
              </div>
            ) : groupedPairs.length === 0 ? (
              <div className={cn(CARD, 'flex flex-col items-center gap-2 px-6 py-12 text-center')}>
                <SearchX className="size-6 text-[var(--estate-text-dim)]" />
                <div className="text-ui text-[var(--estate-ink)]">No matches found between these schemas</div>
                <div className="max-w-md text-caption text-[var(--estate-text-muted)]">
                  The two schemas may not share any data, or every match was rejected earlier.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groupedPairs.map((group) => {
                  const isExpanded = expandedGroups[group.key] !== false;
                  const isRemainderExpanded = expandedRemainder[group.key] === true;
                  const threshold = thresholds[group.key] || '0.85';
                  const confirmingState = bulkConfirming[group.key];

                  const scores = group.mappings.map((m) => m.confidence ?? 0);
                  const avgConf = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                  const groupConfirmed = group.mappings.filter((m) => m.status === 'confirmed').length;
                  const eligible = group.mappings.filter(
                    (m) => m.status === 'proposed' && (m.confidence ?? 0) >= (parseFloat(threshold) || 0.85)
                  ).length;

                  const leftAll = objectColumns[group.leftObjectId]?.map((c) => c.name) || [];
                  const leftMapped = new Set(group.mappings.map((m) => m.leftColName));
                  const leftUnmapped = leftAll.filter((name) => !leftMapped.has(name));
                  const rightAll = objectColumns[group.rightObjectId]?.map((c) => c.name) || [];
                  const rightMapped = new Set(group.mappings.map((m) => m.rightColName));
                  const rightUnmapped = rightAll.filter((name) => !rightMapped.has(name));

                  const toggleGroup = () =>
                    setExpandedGroups((prev) => ({ ...prev, [group.key]: !isExpanded }));

                  return (
                    <div key={group.key} className={cn(CARD, 'overflow-hidden')}>
                      {/* Pair header */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                        <button
                          type="button"
                          onClick={toggleGroup}
                          aria-expanded={isExpanded}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-ctl text-left focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                        >
                          <ChevronRight
                            className={cn(
                              'size-4 shrink-0 text-[var(--estate-text-muted)] transition-transform duration-hover',
                              isExpanded && 'rotate-90'
                            )}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="grid min-w-0 grid-cols-[minmax(0,auto)_auto_minmax(0,auto)] items-center justify-start gap-2">
                              <ObjectNameCell path={group.leftObjectPath} />
                              <ArrowRight className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" />
                              <ObjectNameCell path={group.rightObjectPath} />
                            </span>
                            <span className="text-caption tabular-nums text-[var(--estate-text-muted)]">
                              {group.mappings.length} {group.mappings.length === 1 ? 'match' : 'matches'}
                              {' \u00b7 '}average confidence {formatPct(avgConf)}
                              {' \u00b7 '}
                              {groupConfirmed} confirmed
                            </span>
                          </span>
                        </button>

                        {/* Bulk confirm */}
                        <div className="flex shrink-0 items-center gap-2">
                          <label
                            htmlFor={`thr-${group.key}`}
                            className="text-caption text-[var(--estate-text-muted)]"
                          >
                            Confirm all at or above
                          </label>
                          <Select
                            id={`thr-${group.key}`}
                            value={threshold}
                            onChange={(e) =>
                              setThresholds((prev) => ({ ...prev, [group.key]: e.target.value }))
                            }
                            className={cn(CATALOG_SELECT, 'h-7 pl-2 pr-6 tabular-nums')}
                            style={CATALOG_SELECT_ARROW}
                          >
                            {['0.95', '0.9', '0.85', '0.8', '0.75', '0.7', '0.6', '0.5'].map((t) => (
                              <option key={t} value={t}>
                                {formatPct(parseFloat(t))}
                              </option>
                            ))}
                          </Select>
                          <button
                            type="button"
                            disabled={!!confirmingState || !canAct}
                            title={canAct ? undefined : 'Only platform admins can confirm mappings'}
                            onClick={() => handleBulkConfirm(group)}
                            className={CATALOG_BTN}
                          >
                            {confirmingState ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin" />
                                {confirmingState}
                              </>
                            ) : (
                              <>
                                <Check className="size-3.5" />
                                Confirm {eligible > 0 ? eligible : ''}
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <>
                          <div className="overflow-x-auto border-t border-[var(--estate-border)]">
                            <table className="w-full min-w-[860px] table-fixed text-left">
                              <thead>
                                <tr className="text-caption text-[var(--estate-text-muted)]">
                                  <th className="w-[20%] px-4 py-2 font-medium">Column in first schema</th>
                                  <th className="w-7 py-2" aria-label="maps to" />
                                  <th className="w-[20%] px-3 py-2 font-medium">Column in second schema</th>
                                  <th className="px-3 py-2 font-medium">Why it matches</th>
                                  <th className="w-[124px] px-3 py-2 font-medium">Confidence</th>
                                  <th className="w-[112px] px-3 py-2 font-medium">Status</th>
                                  <th className="w-[150px] px-4 py-2 text-right font-medium">
                                    <span className="sr-only">Actions</span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.mappings.map((m) => {
                                  const isConfirmed = m.status === 'confirmed';
                                  const isRejected = m.status === 'rejected';

                                  const signals = (m.signals || {}) as Record<string, any>;
                                  const signalHint = [
                                    `Meaning ${formatPct(signals.embed_sim ?? 0)}`,
                                    `Name ${formatPct(signals.name_sim ?? 0)}`,
                                    `Type ${formatPct(signals.type_compat ?? 0)}`,
                                    `Shared values ${formatPct(signals.value_overlap_jaccard ?? 0)}`,
                                  ].join(' \u00b7 ');

                                  const verdict = (m.llm_verdict || {}) as Record<string, any>;
                                  const rationale: string = verdict.rationale || verdict.verdict || '';

                                  return (
                                    <tr
                                      key={m.id}
                                      className={cn(
                                        'border-t border-[var(--estate-border)] align-middle transition-colors duration-hover',
                                        isConfirmed && 'bg-[color:color-mix(in_srgb,var(--ok)_5%,transparent)]',
                                        isRejected && 'opacity-55',
                                        !isConfirmed && !isRejected && 'hover:bg-[var(--estate-hover)]'
                                      )}
                                    >
                                      <td className="px-4 py-2.5">
                                        <span
                                          className={cn(
                                            'block truncate font-mono text-ui-regular text-[var(--estate-ink)]',
                                            isRejected && 'line-through'
                                          )}
                                          title={m.leftColName}
                                        >
                                          {m.leftColName}
                                        </span>
                                      </td>
                                      <td className="py-2.5 text-[var(--estate-text-dim)]">
                                        <ArrowRight className="size-3.5" />
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <span
                                          className={cn(
                                            'block truncate font-mono text-ui-regular text-[var(--estate-ink)]',
                                            isRejected && 'line-through'
                                          )}
                                          title={m.rightColName}
                                        >
                                          {m.rightColName}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <span
                                          className="line-clamp-2 text-caption text-[var(--estate-text-muted)]"
                                          title={rationale || undefined}
                                        >
                                          {rationale || '\u2014'}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <ConfidenceBar value={m.confidence} title={signalHint} />
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <MappingStatusPill status={m.status} />
                                      </td>
                                      <td className="px-4 py-2.5">
                                        {canAct && !isConfirmed && !isRejected && (
                                          <div className="flex items-center justify-end gap-1.5">
                                            <button
                                              type="button"
                                              onClick={() => handleUpdateStatus(m.id, 'confirmed')}
                                              className={cn(CATALOG_BTN, 'hover:border-[var(--ok)] hover:text-[var(--ok)]')}
                                            >
                                              <Check className="size-3.5" />
                                              Confirm
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleUpdateStatus(m.id, 'rejected')}
                                              aria-label={`Reject ${m.leftColName} to ${m.rightColName}`}
                                              title="Reject"
                                              className={cn(
                                                CATALOG_BTN,
                                                'w-7 justify-center px-0 hover:border-[var(--bad)] hover:text-[var(--bad)]'
                                              )}
                                            >
                                              <X className="size-3.5" />
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Unmatched columns */}
                          <div className="border-t border-[var(--estate-border)] bg-[var(--estate-surface)] px-4 py-2.5">
                            <button
                              type="button"
                              aria-expanded={isRemainderExpanded}
                              onClick={() =>
                                setExpandedRemainder((prev) => ({ ...prev, [group.key]: !isRemainderExpanded }))
                              }
                              className="flex items-center gap-1.5 rounded-ctl text-label text-[var(--estate-text-secondary)] hover:text-[var(--estate-ink)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                            >
                              <ChevronRight
                                className={cn('size-3.5 transition-transform duration-hover', isRemainderExpanded && 'rotate-90')}
                              />
                              Columns without a match
                              <span className="font-normal tabular-nums text-[var(--estate-text-muted)]">
                                ({leftUnmapped.length + rightUnmapped.length})
                              </span>
                            </button>

                            {isRemainderExpanded && (
                              <div className="mt-3 grid grid-cols-1 gap-4 pb-1 md:grid-cols-2">
                                {[
                                  { label: 'Only in first schema', path: group.leftObjectPath, cols: leftUnmapped },
                                  { label: 'Only in second schema', path: group.rightObjectPath, cols: rightUnmapped },
                                ].map((side) => (
                                  <div key={side.label} className="min-w-0">
                                    <div className="mb-1.5 text-caption text-[var(--estate-text-muted)]">
                                      {side.label}{' '}
                                      <span className="font-mono">{side.path.split('.').pop()}</span>
                                      {' \u00b7 '}
                                      <span className="tabular-nums">{side.cols.length}</span>
                                    </div>
                                    {side.cols.length > 0 ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {side.cols.map((name) => (
                                          <span
                                            key={name}
                                            className="rounded-full border border-[var(--estate-border)] bg-[var(--estate-raised)] px-2 py-0.5 font-mono text-caption text-[var(--estate-text-secondary)]"
                                          >
                                            {name}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-caption text-[var(--estate-text-dim)]">Every column has a match.</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// extracted SchemaPicker component
interface SchemaPickerProps {
  badge: string;
  title: string;
  sources: Source[];
  loadingSources: boolean;
  value: PickerState | null;
  onChange: (val: PickerState | null) => void;
}

function SchemaPicker({
  badge,
  title,
  sources,
  loadingSources,
  value,
  onChange,
}: SchemaPickerProps) {
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  // Coverage statistics
  const [totalObjects, setTotalObjects] = useState<number | null>(null);
  const [enrichedObjects, setEnrichedObjects] = useState<number | null>(null);
  const [loadingCoverage, setLoadingCoverage] = useState(false);

  const selectCls = cn(CATALOG_SELECT, 'w-full disabled:cursor-not-allowed disabled:opacity-60');
  const idBase = `picker-${badge}`;

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

  const ready = !!(value?.sourceId && value?.catalogName && value?.schemaName);
  const missing =
    totalObjects !== null && enrichedObjects !== null && enrichedObjects < totalObjects
      ? totalObjects - enrichedObjects
      : 0;

  return (
    <div className={cn(CARD, 'flex min-w-0 flex-col')}>
      <div className="flex items-center gap-2.5 border-b border-[var(--estate-border)] px-4 py-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-caption font-semibold text-[var(--brand-a)]">
          {badge}
        </span>
        <h2 className="text-title-card text-[var(--estate-ink)]">{title}</h2>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`${idBase}-source`}>Source</FieldLabel>
          <Select
            id={`${idBase}-source`}
            className={selectCls}
            style={CATALOG_SELECT_ARROW}
            value={value?.sourceId || ''}
            onChange={(e) => handleSourceChange(e.target.value)}
          >
            <option value="">{loadingSources ? 'Loading sources\u2026' : 'Choose a source'}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name || s.connection_kind} ({s.status})
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor={`${idBase}-catalog`}>Catalog</FieldLabel>
            <Select
              id={`${idBase}-catalog`}
              className={selectCls}
              style={CATALOG_SELECT_ARROW}
              disabled={!value?.sourceId || loadingCatalogs}
              value={value?.catalogName || ''}
              onChange={(e) => handleCatalogChange(e.target.value)}
            >
              <option value="">{loadingCatalogs ? 'Loading\u2026' : 'Choose a catalog'}</option>
              {catalogs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <FieldLabel htmlFor={`${idBase}-schema`}>Schema</FieldLabel>
            <Select
              id={`${idBase}-schema`}
              className={selectCls}
              style={CATALOG_SELECT_ARROW}
              disabled={!value?.catalogName || loadingSchemas}
              value={value?.schemaName || ''}
              onChange={(e) => handleSchemaChange(e.target.value)}
            >
              <option value="">{loadingSchemas ? 'Loading\u2026' : 'Choose a schema'}</option>
              {schemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-[var(--estate-border)] px-4 py-3 text-caption">
        {!ready ? (
          <span className="text-[var(--estate-text-muted)]">Pick a source, catalog and schema.</span>
        ) : loadingCoverage ? (
          <span className="flex items-center gap-1.5 text-[var(--estate-text-muted)]">
            <Loader2 className="size-3 animate-spin" />
            Checking tables{'\u2026'}
          </span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 tabular-nums text-[var(--estate-text-secondary)]">
              {missing === 0 ? (
                <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
              ) : (
                <AlertTriangle className="size-3.5 text-[var(--warn)]" />
              )}
              <span>
                <span className="text-[var(--estate-ink)]">{formatCompactCount(totalObjects ?? 0)}</span>{' '}
                {totalObjects === 1 ? 'table' : 'tables'}
                {' \u00b7 '}
                <span className="text-[var(--estate-ink)]">{formatCompactCount(enrichedObjects ?? 0)}</span> with
                descriptions
              </span>
            </div>
            {missing > 0 && (
              <div className="text-[var(--estate-text-muted)]">
                {missing.toLocaleString()} {missing === 1 ? 'table has' : 'tables have'} no description yet, so
                matches may be less accurate.{' '}
                <Link
                  href="/agent-lab/estate/catalog"
                  className="inline-flex items-center gap-0.5 text-[var(--brand-a)] hover:underline"
                >
                  Add descriptions in Catalog
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
