'use client';

import React, { useMemo } from 'react';
import { ESTATE_PIPELINE_TIERS } from '@/lib/estate/stages';

const CONTINUE_TIER_IDS = ['t0', 't1', 't2', 'embed', 't3', 't4'] as const;
export type ContinueTierId = (typeof CONTINUE_TIER_IDS)[number];

const CATALOG_TIERS: ContinueTierId[] = ['t0', 't1', 't2', 'embed'];

const STAGE_LABEL: Record<string, string> = {
  t0_structural: 'Structure',
  t1_profile: 'Profile',
  t2_semantic: 'Describe',
  embed: 'Searchable',
  t3_usage: 'Linked',
  t4_scan: 'In model',
};

type PresetId = 'catalog' | 'full' | 'usage';

const PRESETS: { id: PresetId; label: string; tiers: ContinueTierId[] }[] = [
  { id: 'catalog', label: 'Catalog', tiers: ['t0', 't1', 't2', 'embed'] },
  { id: 'full', label: 'Full', tiers: ['t0', 't1', 't2', 'embed', 't3', 't4'] },
  { id: 'usage', label: 'Usage only', tiers: ['t3'] },
];

export interface ScopeChangeCheck {
  listed: number;
  unchanged: number;
  changed: string[];
  added: string[];
  dropped: string[];
  unknown: string[];
}

export interface ContinuePipelineModalProps {
  open: boolean;
  scopeDisplay: string;
  scopeTitle: string;
  scannedOnly: boolean;
  onScannedOnlyChange: (v: boolean) => void;
  selectedTiers: ContinueTierId[];
  onSelectedTiersChange: (tiers: ContinueTierId[]) => void;
  checking: boolean;
  launching: boolean;
  canRun: boolean;
  planError: string | null;
  onRetryCheck: () => void;
  changeCheck: ScopeChangeCheck | null;
  stagePlan: Array<{ kind: string; upTo: number }>;
  idleMessage?: string;
  overlapMessage?: string;
  scannedObjectCount: number;
  onClose: () => void;
  onRun: () => void;
}

function catalogMaxIndex(selected: Set<ContinueTierId>): number {
  let max = -1;
  for (let i = 0; i < CATALOG_TIERS.length; i++) {
    if (selected.has(CATALOG_TIERS[i]!)) max = i;
  }
  return max;
}

function tiersFromCatalogMax(maxIdx: number, warehouse: { t3: boolean; t4: boolean }): ContinueTierId[] {
  const out: ContinueTierId[] = [];
  for (let i = 0; i <= maxIdx; i++) out.push(CATALOG_TIERS[i]!);
  if (warehouse.t3) out.push('t3');
  if (warehouse.t4) out.push('t4');
  return out;
}

export function ContinuePipelineModal(props: ContinuePipelineModalProps) {
  if (!props.open) return null;

  const {
    scopeDisplay,
    scopeTitle,
    scannedOnly,
    onScannedOnlyChange,
    selectedTiers,
    onSelectedTiersChange,
    checking,
    launching,
    canRun,
    planError,
    onRetryCheck,
    changeCheck,
    stagePlan,
    idleMessage,
    overlapMessage,
    scannedObjectCount,
    onClose,
    onRun,
  } = props;

  const selectedSet = useMemo(() => new Set(selectedTiers), [selectedTiers]);
  const catalogMax = useMemo(() => catalogMaxIndex(selectedSet), [selectedSet]);
  const t3On = selectedSet.has('t3');
  const t4On = selectedSet.has('t4');

  const activePreset = useMemo((): PresetId | null => {
    for (const p of PRESETS) {
      if (p.tiers.length !== selectedTiers.length) continue;
      if (p.tiers.every(t => selectedSet.has(t))) return p.id;
    }
    return null;
  }, [selectedSet, selectedTiers]);

  function setWarehouse(nextT3: boolean, nextT4: boolean) {
    onSelectedTiersChange(tiersFromCatalogMax(catalogMax, { t3: nextT3, t4: nextT4 }));
  }

  function clickCatalogTier(tierId: ContinueTierId) {
    const idx = CATALOG_TIERS.indexOf(tierId);
    if (idx < 0) return;
    let nextMax = idx;
    if (idx <= catalogMax && idx === catalogMax) nextMax = idx - 1;
    onSelectedTiersChange(tiersFromCatalogMax(nextMax, { t3: t3On, t4: t4On }));
  }

  function tierDisabled(tierId: ContinueTierId): boolean {
    if (checking || launching) return true;
    if ((tierId === 't3' || tierId === 't4') && scannedObjectCount === 0) return true;
    return false;
  }

  const planLine =
    stagePlan.length > 0
      ? stagePlan.map(s => STAGE_LABEL[s.kind] ?? s.kind).join(' → ')
      : null;

  const statusLine = checking
    ? 'Checking Databricks…'
    : planError
      ? planError
      : overlapMessage
        ? overlapMessage
        : planLine
          ? planLine
          : idleMessage ?? 'Pick stages on the pipeline. Catalog steps run only when stale.';

  const statusTone = planError || overlapMessage ? 'bad' : stagePlan.length > 0 ? 'ready' : 'muted';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="continue-pipeline-title"
    >
      <div
        className="absolute inset-0 bg-[var(--estate-bg)]/55 backdrop-blur-sm"
        onClick={() => !launching && !checking && onClose()}
      />
      <div
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--estate-raised)', borderColor: 'var(--estate-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id="continue-pipeline-title" className="text-size-ui font-semibold" style={{ color: 'var(--estate-ink)' }}>
              Continue pipeline
            </h2>
            <p className="mt-1 truncate font-mono text-caption" style={{ color: 'var(--estate-text-muted)' }} title={scopeTitle}>
              {scopeDisplay}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={launching}
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[var(--estate-surface)]"
            style={{ color: 'var(--estate-text-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="space-y-5 px-5 pb-4">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                disabled={checking || launching || (p.id === 'usage' && scannedObjectCount === 0)}
                onClick={() => onSelectedTiersChange([...p.tiers])}
                className="text-label underline-offset-2 transition-opacity hover:underline disabled:opacity-35"
                style={{
                  color: activePreset === p.id ? 'var(--brand-a)' : 'var(--estate-text-secondary)',
                  fontWeight: activePreset === p.id ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <LinkedPipeline
            catalogMax={catalogMax}
            t3On={t3On}
            t4On={t4On}
            disabled={checking || launching}
            tierDisabled={tierDisabled}
            onCatalogClick={clickCatalogTier}
            onT3={() => setWarehouse(!t3On, t4On)}
            onT4={() => setWarehouse(t3On, !t4On)}
          />

          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand-a)]"
              checked={scannedOnly}
              disabled={checking || launching}
              onChange={e => onScannedOnlyChange(e.target.checked)}
            />
            <span className="text-caption" style={{ color: 'var(--estate-text-secondary)' }}>
              Scanned tables only
            </span>
          </label>

          <div
            className="rounded-xl px-3 py-2.5 text-caption leading-relaxed"
            style={{
              background: 'var(--estate-surface)',
              color:
                statusTone === 'bad'
                  ? 'var(--bad)'
                  : statusTone === 'ready'
                    ? 'var(--estate-ink)'
                    : 'var(--estate-text-muted)',
            }}
          >
            {!checking && changeCheck && !planError && (
              <p className="mb-1" style={{ color: 'var(--estate-text-secondary)' }}>
                {describeCheck(changeCheck)}
              </p>
            )}
            <p>{statusLine}</p>
            {planError && !checking && (
              <button type="button" onClick={onRetryCheck} className="mt-1 text-label underline" style={{ color: 'var(--bad)' }}>
                Retry check
              </button>
            )}
          </div>
        </div>

        <footer
          className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-4"
          style={{ borderColor: 'var(--estate-border)' }}
        >
          <button
            type="button"
            disabled={launching}
            onClick={onClose}
            className="text-label rounded-lg px-4 py-2 transition-colors hover:bg-[var(--estate-surface)]"
            style={{ color: 'var(--estate-text-secondary)' }}
          >
            Cancel
          </button>
          {canRun && (
            <button
              type="button"
              disabled={launching || checking}
              onClick={onRun}
              className="text-label rounded-lg px-5 py-2 font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand-a)', color: 'var(--on-brand)' }}
            >
              {launching ? 'Launching…' : 'Run pipeline'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function LinkedPipeline({
  catalogMax,
  t3On,
  t4On,
  disabled,
  tierDisabled,
  onCatalogClick,
  onT3,
  onT4,
}: {
  catalogMax: number;
  t3On: boolean;
  t4On: boolean;
  disabled: boolean;
  tierDisabled: (id: ContinueTierId) => boolean;
  onCatalogClick: (id: ContinueTierId) => void;
  onT3: () => void;
  onT4: () => void;
}) {
  const warehouseDisabled = disabled || tierDisabled('t3');

  return (
    <div className="space-y-4 overflow-x-auto pb-1">
      <div>
        <p className="mb-3 text-label font-medium" style={{ color: 'var(--estate-text-muted)' }}>
          Catalog
        </p>
        <PipelineTrack
          tierIds={CATALOG_TIERS}
          isOn={(_id, i) => i <= catalogMax}
          disabled={disabled}
          tierDisabled={tierDisabled}
          onNodeClick={onCatalogClick}
          linkActive={(i) => i < catalogMax}
        />
      </div>

      <div
        className="h-px w-full"
        style={{ background: 'var(--estate-border)' }}
        aria-hidden
      />

      <div>
        <p className="mb-3 text-label font-medium" style={{ color: 'var(--estate-text-muted)' }}>
          Usage & model
        </p>
        <PipelineTrack
          tierIds={['t3', 't4']}
          isOn={(id) => (id === 't3' ? t3On : t4On)}
          disabled={warehouseDisabled}
          tierDisabled={tierDisabled}
          onNodeClick={id => (id === 't3' ? onT3() : onT4())}
          linkActive={(i) => i === 0 && t3On && t4On}
        />
        {tierDisabled('t3') && !disabled && (
          <p className="mt-2 text-caption" style={{ color: 'var(--estate-text-muted)' }}>
            Needs at least one scanned table in this scope.
          </p>
        )}
      </div>
    </div>
  );
}

function PipelineTrack({
  tierIds,
  isOn,
  disabled,
  tierDisabled,
  onNodeClick,
  linkActive,
}: {
  tierIds: ContinueTierId[];
  isOn: (id: ContinueTierId, index: number) => boolean;
  disabled: boolean;
  tierDisabled: (id: ContinueTierId) => boolean;
  onNodeClick: (id: ContinueTierId) => void;
  linkActive: (segmentIndex: number) => boolean;
}) {
  return (
    <div className="flex items-start">
      {tierIds.map((tierId, i) => {
        const meta = ESTATE_PIPELINE_TIERS.find(t => t.id === tierId)!;
        const on = isOn(tierId, i);
        const off = disabled || tierDisabled(tierId);
        const segmentOn = i < tierIds.length - 1 && linkActive(i);
        const segColor = ESTATE_PIPELINE_TIERS.find(t => t.id === tierIds[i + 1])?.color ?? meta.color;

        return (
          <React.Fragment key={tierId}>
            <button
              type="button"
              disabled={off}
              onClick={() => onNodeClick(tierId)}
              className="flex w-[4.25rem] shrink-0 flex-col items-center gap-1.5 disabled:opacity-35 sm:w-[4.75rem]"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-label font-semibold transition-all"
                style={{
                  borderColor: on ? meta.color : 'var(--estate-border)',
                  background: on ? meta.color : 'var(--estate-raised)',
                  color: on ? 'var(--estate-raised)' : 'var(--estate-text-muted)',
                  boxShadow: on ? `0 0 0 3px color-mix(in srgb, ${meta.color} 28%, transparent)` : undefined,
                }}
              >
                {nodeShortLabel(meta.label)}
              </span>
              <span
                className="w-full truncate text-center text-caption leading-tight"
                style={{ color: on ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }}
              >
                {meta.plainLabel}
              </span>
            </button>
            {i < tierIds.length - 1 && (
              <div
                className="mt-[18px] h-0.5 min-w-[0.75rem] flex-1 rounded-full transition-colors"
                style={{
                  background: segmentOn ? segColor : 'var(--estate-border)',
                  opacity: segmentOn ? 0.9 : 1,
                }}
                aria-hidden
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function nodeShortLabel(label: string): string {
  if (label === 'Embed') return 'E';
  return label.replace('T', '');
}

function describeCheck(c: ScopeChangeCheck): string {
  const parts: string[] = [];
  if (c.changed.length) parts.push(`${c.changed.length} changed`);
  if (c.added.length) parts.push(`${c.added.length} new`);
  if (c.dropped.length) parts.push(`${c.dropped.length} removed`);
  if (c.unknown.length) parts.push(`${c.unknown.length} need rescan`);
  if (parts.length === 0) {
    return `Source OK — no changes since last scan (${c.unchanged.toLocaleString()} table${c.unchanged === 1 ? '' : 's'}).`;
  }
  return `Source check — ${parts.join(' · ')} · ${c.unchanged.toLocaleString()} unchanged`;
}

export { CONTINUE_TIER_IDS, STAGE_LABEL };
