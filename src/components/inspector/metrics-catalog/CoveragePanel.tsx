'use client';

import React from 'react';
import { BarChart3, LayoutGrid, AlertTriangle, ChevronDown } from 'lucide-react';
import { useCatalogStore, selectCoverage, type CoverageBucket } from './catalog-store';
import { MONO, SERIF, MUTED, INK, INK_DIM, BORDER, GOLD } from './mc-ui';

/**
 * Coverage — governed / candidate / draft by theme. Collapsed by default to a
 * one-line summary. Expands to show bars or treemap. Clicking a theme bar sets
 * the Theme facet; "Gaps only" filters to under-governed themes.
 */
export function CoveragePanel() {
  const rows = useCatalogStore((s) => s.rows);
  const mode = useCatalogStore((s) => s.coverageMode);
  const setMode = useCatalogStore((s) => s.setCoverageMode);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);
  const setGapsOnly = useCatalogStore((s) => s.setGapsOnly);
  const setThemeFacet = useCatalogStore((s) => s.setThemeFacet);
  const themeFacet = useCatalogStore((s) => s.facets.theme);

  const [expanded, setExpanded] = React.useState(false);

  const buckets = React.useMemo(() => selectCoverage(rows), [rows]);
  const gapCount = buckets.filter((b) => b.gap).length;
  const totalDefs = buckets.reduce((s, b) => s + b.total, 0);
  const totalGoverned = buckets.reduce((s, b) => s + b.governed, 0);
  const overallPct = totalDefs > 0 ? Math.round((totalGoverned / totalDefs) * 100) : 0;

  if (!buckets.length) return null;

  return (
    <div style={{ borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: 10,
          padding: '8px 20px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ ...SERIF, fontSize: 13, fontWeight: 600, color: INK, flexShrink: 0 }}>
          Coverage
        </span>
        {/* Mini stacked bar */}
        <span
          style={{
            flex: '0 0 100px',
            height: 8,
            borderRadius: 3,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            display: 'flex',
          }}
        >
          {totalGoverned > 0 && (
            <span
              style={{
                width: `${overallPct}%`,
                background: 'var(--mc-status-governed)',
              }}
            />
          )}
          {(totalDefs - totalGoverned) > 0 && (
            <span
              style={{
                flex: 1,
                background: 'var(--mc-status-candidate)',
              }}
            />
          )}
        </span>
        <span style={{ ...MONO, fontSize: 10, color: overallPct < 50 ? GOLD : INK_DIM }}>
          {overallPct}% governed
        </span>
        <span style={{ ...MONO, fontSize: 10, color: MUTED }}>
          {buckets.length} theme{buckets.length !== 1 ? 's' : ''}
        </span>
        {gapCount > 0 && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              ...MONO,
              fontSize: 10,
              color: GOLD,
            }}
          >
            <AlertTriangle size={11} />
            {gapCount} gap{gapCount !== 1 ? 's' : ''}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ChevronDown
          size={13}
          color={MUTED}
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 20px 14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.06em' }}>
              GOVERNED / CANDIDATE / DRAFT BY THEME
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setGapsOnly(!gapsOnly); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  ...MONO,
                  fontSize: 10,
                  padding: '4px 9px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: `1px solid ${gapsOnly ? GOLD : BORDER}`,
                  background: gapsOnly ? 'rgba(253,181,21,0.12)' : 'transparent',
                  color: gapsOnly ? GOLD : MUTED,
                }}
              >
                <AlertTriangle size={11} /> Gaps only {gapCount ? `(${gapCount})` : ''}
              </button>
              <div style={{ display: 'flex', gap: 2, border: `1px solid ${BORDER}`, borderRadius: 4, padding: 2 }}>
                <ModeBtn active={mode === 'bars'} onClick={() => setMode('bars')} icon={<BarChart3 size={12} />} />
                <ModeBtn active={mode === 'treemap'} onClick={() => setMode('treemap')} icon={<LayoutGrid size={12} />} />
              </div>
            </div>
          </div>

          {mode === 'bars' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {buckets.map((b) => (
                <CoverageBar
                  key={b.theme}
                  bucket={b}
                  active={themeFacet.includes(b.theme)}
                  onClick={() => setThemeFacet(b.theme)}
                />
              ))}
            </div>
          ) : (
            <Treemap buckets={buckets} activeThemes={themeFacet} onPick={setThemeFacet} />
          )}
        </div>
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '3px 7px',
        borderRadius: 3,
        border: 'none',
        cursor: 'pointer',
        background: active ? GOLD : 'transparent',
        color: active ? '#1A1206' : MUTED,
      }}
    >
      {icon}
    </button>
  );
}

const SEG_GOV = 'var(--mc-status-governed)';
const SEG_CAND = 'var(--mc-status-candidate)';
const SEG_DRAFT = 'var(--mc-status-draft)';

function CoverageBar({ bucket, active, onClick }: { bucket: CoverageBucket; active: boolean; onClick: () => void }) {
  const denom = bucket.governed + bucket.candidate + bucket.draft || 1;
  const pct = (n: number) => `${(n / denom) * 100}%`;
  return (
    <button
      onClick={onClick}
      title={`${bucket.governed} governed · ${bucket.candidate} candidate · ${bucket.draft} draft`}
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr 92px',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        background: active ? 'rgba(253,181,21,0.06)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        padding: '3px 6px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {bucket.gap && <AlertTriangle size={11} color={GOLD} style={{ flexShrink: 0 }} />}
        <span
          style={{
            ...MONO,
            fontSize: 11,
            color: active ? GOLD : INK_DIM,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {bucket.theme}
        </span>
        <span style={{ ...MONO, fontSize: 9, color: MUTED, flexShrink: 0 }}>{bucket.total}</span>
      </span>
      <span
        style={{
          display: 'flex',
          height: 12,
          borderRadius: 3,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        {bucket.governed > 0 && <span style={{ width: pct(bucket.governed), background: SEG_GOV }} />}
        {bucket.candidate > 0 && <span style={{ width: pct(bucket.candidate), background: SEG_CAND }} />}
        {bucket.draft > 0 && <span style={{ width: pct(bucket.draft), background: SEG_DRAFT }} />}
      </span>
      <span style={{ ...MONO, fontSize: 10, color: bucket.gap ? GOLD : MUTED, textAlign: 'right' }}>
        {Math.round(bucket.govPct * 100)}% gov
      </span>
    </button>
  );
}

function Treemap({ buckets, activeThemes, onPick }: { buckets: CoverageBucket[]; activeThemes: string[]; onPick: (t: string) => void }) {
  const total = buckets.reduce((s, b) => s + b.total, 0) || 1;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {buckets.map((b) => {
        const share = b.total / total;
        const basis = Math.max(90, Math.round(share * 900));
        return (
          <button
            key={b.theme}
            onClick={() => onPick(b.theme)}
            title={`${b.theme} — ${b.total} items · ${Math.round(b.govPct * 100)}% governed`}
            style={{
              flex: `1 1 ${basis}px`,
              minHeight: 54,
              borderRadius: 4,
              padding: '8px 10px',
              cursor: 'pointer',
              textAlign: 'left',
              color: INK,
              border: `1px solid ${activeThemes.includes(b.theme) ? GOLD : BORDER}`,
              background: `linear-gradient(90deg, ${SEG_GOV} 0 ${b.govPct * 100}%, ${SEG_CAND} ${b.govPct * 100}% 100%)`,
              backgroundBlendMode: 'normal',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <span style={{ position: 'absolute', inset: 0, background: 'rgba(7,11,17,0.55)' }} />
            <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ ...MONO, fontSize: 11, color: '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
                {b.gap && <AlertTriangle size={10} color={GOLD} />} {b.theme}
              </span>
              <span style={{ ...MONO, fontSize: 9, color: 'rgba(255,255,255,0.75)' }}>
                {b.total} · {Math.round(b.govPct * 100)}% gov
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

