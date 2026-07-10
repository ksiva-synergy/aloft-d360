'use client';

import React, { useState } from 'react';
import EstateCatalogTab from '@/components/estate/EstateCatalogTab';
import { ScannedObjectsTab } from '@/components/estate';
import { useCatalogRefresh } from '@/components/estate/useCatalogRefresh';

type TabView = 'discovery' | 'scanned';

export default function EstateCatalogPage() {
  const [view, setView] = useState<TabView>('discovery');
  const [showTestSources, setShowTestSources] = useState(false);
  const refreshKey = useCatalogRefresh();

  const borderColor = 'var(--estate-border)';
  const borderStrong = 'var(--estate-btn-border)';
  const bgColor = 'var(--estate-bg)';
  const goldColor = '#FDB515';
  const textMuted = 'var(--estate-text-muted)';
  const textDim = 'var(--estate-text-dim)';
  const activeBg = goldColor;
  const activeText = 'var(--estate-bg)';

  const segStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: active ? activeText : textMuted,
    cursor: 'pointer',
    background: active ? activeBg : 'transparent',
    border: 'none',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: bgColor }}>
      {/* Sub-row: segmented control + sync status */}
      <div
        className="flex items-center justify-between px-6 py-3.5"
        style={{ background: bgColor }}
      >
        <div
          className="flex overflow-hidden rounded-md"
          style={{ border: `1px solid ${borderStrong}` }}
        >
          <button
            type="button"
            onClick={() => setView('discovery')}
            style={{
              ...segStyle(view === 'discovery'),
              borderRight: `1px solid ${borderColor}`,
            }}
          >
            Discovery <span style={{ fontSize: '10.5px', opacity: 0.85 }}>●</span>
          </button>
          <button
            type="button"
            onClick={() => setView('scanned')}
            style={segStyle(view === 'scanned')}
          >
            Scanned &amp; Beyond <span style={{ fontSize: '10.5px', opacity: 0.85 }}>●</span>
          </button>
        </div>

        <div
          className="flex items-center gap-3.5"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', color: textDim, letterSpacing: '0.06em' }}
        >
          {/* Test sources toggle */}
          <button
            type="button"
            onClick={() => setShowTestSources(s => !s)}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '10.5px',
              letterSpacing: '0.06em',
              backgroundColor: showTestSources ? 'rgba(253,181,21,0.12)' : 'transparent',
              border: `1px solid ${showTestSources ? 'rgba(253,181,21,0.5)' : borderStrong}`,
              borderRadius: '6px',
              color: showTestSources ? goldColor : textMuted,
              padding: '5px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {showTestSources ? '⚗ Test: shown' : '⚗ Test: hidden'}
          </button>

          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: '#3fb950', boxShadow: '0 0 6px rgba(63, 185, 80, 0.5)' }}
          />
          <span>
            {view === 'discovery' ? 'Estate inventory active' : 'Scanned · Enriched · Embedded'}
          </span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'discovery' ? (
          <EstateCatalogTab refreshKey={refreshKey} showTestSources={showTestSources} />
        ) : (
          <ScannedObjectsTab refreshKey={refreshKey} showTestSources={showTestSources} />
        )}
      </div>
    </div>
  );
}
