'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { schemaIncludePattern } from '@/lib/estate/catalog-pipeline';

type WizardStep = 1 | 2 | 3 | 4;

type IntentId = 'refresh_discovery' | 'scan_new' | 'profile_enrich' | 'usage_only';

const INTENTS: {
  id: IntentId;
  title: string;
  detail: string;
  kinds: string[];
  sequential: boolean;
}[] = [
  {
    id: 'refresh_discovery',
    title: 'Refresh discovery',
    detail: 'Re-list tables in Databricks (discovery registry)',
    kinds: ['estate_inventory'],
    sequential: false,
  },
  {
    id: 'scan_new',
    title: 'Scan new tables',
    detail: 'Structural scan (T0) for Limit scope',
    kinds: ['t0_structural'],
    sequential: false,
  },
  {
    id: 'profile_enrich',
    title: 'Profile & enrich',
    detail: 'Stale T1 → T2 → embed for already-scanned tables',
    kinds: ['t1_profile', 't2_semantic', 'embed'],
    sequential: true,
  },
  {
    id: 'usage_only',
    title: 'Usage only',
    detail: 'T3 query history for in-scope scanned tables',
    kinds: ['t3_usage'],
    sequential: false,
  },
];

interface FacetSchema {
  catalog: string;
  name: string;
  count: number;
}

interface PlanPreview {
  humanSummary?: string;
  registry?: string;
  discoveryObjects?: number;
  scannedObjects?: number;
  staleObjectCount?: number;
  totalObjects?: number;
  emptyScope?: boolean;
  needsSplit?: boolean;
  chunks?: number;
}

interface JobsLaunchWizardProps {
  open: boolean;
  onClose: () => void;
  sourceId?: string;
  onLaunched?: () => void;
}

export default function JobsLaunchWizard({ open, onClose, sourceId, onLaunched }: JobsLaunchWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [intentId, setIntentId] = useState<IntentId>('profile_enrich');
  const [schemas, setSchemas] = useState<FacetSchema[]>([]);
  const [selectedSchemaKeys, setSelectedSchemaKeys] = useState<Set<string>>(new Set());
  const [advancedGlobs, setAdvancedGlobs] = useState('');
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [launching, setLaunching] = useState(false);

  const intent = INTENTS.find(i => i.id === intentId)!;

  const includePatterns = useMemo(() => {
    const fromGlobs = advancedGlobs
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (fromGlobs.length > 0) return fromGlobs;
    return [...selectedSchemaKeys].map(key => {
      const dot = key.indexOf('.');
      if (dot <= 0) return key;
      return schemaIncludePattern(key.slice(0, dot), key.slice(dot + 1));
    });
  }, [advancedGlobs, selectedSchemaKeys]);

  const loadSchemas = useCallback(async () => {
    const res = await fetch('/api/agent-lab/context/objects/scanned/facets?excludeTestSources=true');
    if (res.ok) {
      const json = await res.json();
      setSchemas(json.schemas ?? []);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep(1);
      setPlan(null);
      void loadSchemas();
    }
  }, [open, loadSchemas]);

  useEffect(() => {
    if (step !== 3 || includePatterns.length === 0) return;
    const kind = intent.kinds[0];
    if (!kind) return;
    setPlanLoading(true);
    fetch('/api/agent-lab/context/jobs/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        includePatterns,
        excludeSchemas: [],
        sourceId,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(json => setPlan(json ?? null))
      .finally(() => setPlanLoading(false));
  }, [step, intent.kinds, includePatterns, sourceId]);

  function toggleSchema(catalog: string, name: string) {
    const key = `${catalog}.${name}`;
    setAdvancedGlobs('');
    setSelectedSchemaKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (next.size >= 12) return prev;
        next.add(key);
      }
      return next;
    });
  }

  async function runLaunch() {
    setLaunching(true);
    try {
      const res = await fetch('/api/agent-lab/context/jobs/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kinds: intent.kinds,
          includePatterns,
          excludeSchemas: [],
          sequential: intent.sequential,
          sourceId,
          uiSurface: 'jobs_wizard',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Launch failed', { description: json.message ?? json.error });
        return;
      }
      toast.success('Launched on Fargate', { description: intent.kinds.join(' → ') });
      onLaunched?.();
      onClose();
    } finally {
      setLaunching(false);
    }
  }

  if (!open) return null;

  const canNextStep2 = includePatterns.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => !launching && onClose()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl border shadow-2xl"
        style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--estate-border)' }}>
          <div>
            <h2 className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>
              Guided launch
            </h2>
            <p className="text-caption" style={{ color: 'var(--estate-text-muted)' }}>
              Step {step} of 4 — {['Intent', 'Scope', 'Review', 'Run'][step - 1]}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-label px-2 py-1" style={{ color: 'var(--estate-text-muted)' }}>
            Close
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {INTENTS.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setIntentId(card.id)}
                  className="text-left p-4 rounded-lg border transition-colors"
                  style={{
                    borderColor: intentId === card.id ? 'var(--brand-a)' : 'var(--estate-border)',
                    background: intentId === card.id ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : 'transparent',
                  }}
                >
                  <div className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>{card.title}</div>
                  <div className="text-caption mt-1" style={{ color: 'var(--estate-text-secondary)' }}>{card.detail}</div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <>
              <p className="text-caption" style={{ color: 'var(--estate-text-secondary)' }}>
                Limit to scanned schemas (checkbox). Advanced: one glob per line.
              </p>
              <div className="max-h-48 overflow-auto rounded border p-2 space-y-1" style={{ borderColor: 'var(--estate-border)' }}>
                {schemas.slice(0, 200).map(sch => {
                  const key = `${sch.catalog}.${sch.name}`;
                  return (
                    <label key={key} className="flex items-center gap-2 text-caption font-mono cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSchemaKeys.has(key)}
                        onChange={() => toggleSchema(sch.catalog, sch.name)}
                      />
                      <span className="truncate flex-1">{key}</span>
                      <span style={{ color: 'var(--estate-text-muted)' }}>{sch.count}</span>
                    </label>
                  );
                })}
              </div>
              <textarea
                value={advancedGlobs}
                onChange={e => {
                  setAdvancedGlobs(e.target.value);
                  if (e.target.value.trim()) setSelectedSchemaKeys(new Set());
                }}
                placeholder="Advanced — Limit globs (one per line), e.g. curated_db.my_schema.*"
                className="w-full min-h-[72px] p-3 rounded border font-mono text-caption"
                style={{ borderColor: 'var(--estate-border)', background: 'var(--estate-surface)' }}
              />
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {planLoading && <p className="text-caption" style={{ color: 'var(--estate-text-muted)' }}>Loading plan…</p>}
              {plan && (
                <>
                  <p className="text-size-ui" style={{ color: 'var(--estate-ink)' }}>{plan.humanSummary}</p>
                  {plan.registry === 'estate' && typeof plan.discoveryObjects === 'number' && (
                    <p className="text-caption" style={{ color: 'var(--estate-text-secondary)' }}>
                      In Databricks (discovery): {plan.discoveryObjects.toLocaleString()} table(s)
                    </p>
                  )}
                  {typeof plan.scannedObjects === 'number' && plan.registry !== 'estate' && (
                    <p className="text-caption" style={{ color: 'var(--estate-text-secondary)' }}>
                      Already scanned: {plan.scannedObjects.toLocaleString()} table(s)
                    </p>
                  )}
                  {typeof plan.staleObjectCount === 'number' && (
                    <p className="text-caption" style={{ color: '#86EFAC' }}>
                      Stale (will touch): {plan.staleObjectCount.toLocaleString()}
                    </p>
                  )}
                  {plan.needsSplit && (
                    <p className="text-caption" style={{ color: 'var(--brand-a-ink)' }}>
                      Auto-split: {plan.chunks} chunk(s)
                    </p>
                  )}
                  {plan.emptyScope && (
                    <p className="text-caption" style={{ color: '#EF4444' }}>
                      Nothing to run at this stage for this Limit — adjust scope or intent.
                    </p>
                  )}
                  <p className="text-caption font-mono" style={{ color: 'var(--estate-text-muted)' }}>
                    Chain: {intent.sequential ? intent.kinds.join(' → ') : intent.kinds[0]}
                  </p>
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2">
              <p className="text-size-ui" style={{ color: 'var(--estate-ink)' }}>
                Run {intent.sequential ? 'pipeline in order' : intent.kinds[0]} on Fargate for:
              </p>
              <p className="text-caption font-mono" style={{ color: 'var(--brand-a-ink)' }}>
                {includePatterns.length === 1 ? includePatterns[0] : `${includePatterns.length} Limit patterns`}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between px-5 py-4 border-t" style={{ borderColor: 'var(--estate-border)' }}>
          <button
            type="button"
            disabled={step === 1 || launching}
            onClick={() => setStep(s => (s > 1 ? ((s - 1) as WizardStep) : s))}
            className="text-label px-4 py-2 rounded border disabled:opacity-40"
            style={{ borderColor: 'var(--estate-border)' }}
          >
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              disabled={(step === 2 && !canNextStep2) || (step === 3 && plan?.emptyScope)}
              onClick={() => setStep(s => (s < 4 ? ((s + 1) as WizardStep) : s))}
              className="text-label px-4 py-2 rounded border-none disabled:opacity-40"
              style={{ background: 'var(--brand-a)', color: 'var(--estate-bg)' }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={launching || includePatterns.length === 0}
              onClick={() => void runLaunch()}
              className="text-label px-4 py-2 rounded border-none disabled:opacity-40"
              style={{ background: 'var(--brand-a)', color: 'var(--estate-bg)' }}
            >
              {launching ? 'Launching…' : 'Run on Fargate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
