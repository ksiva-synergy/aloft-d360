'use client';

import React, { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import type { ChartSpec, ColumnProfile } from '@/lib/studio/types';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface InsightItem {
  headline: string;
  body: string;
  kind: 'dominance' | 'outlier' | 'trend' | 'distribution' | 'data_quality' | 'parity';
  confidence: 'high' | 'medium';
  columns: string[];
}

export interface InsightResult {
  insights: InsightItem[];
}

export type InsightCacheEntry = InsightResult | 'loading' | 'error';

export interface InsightRailProps {
  result: QueryResult;
  resultIndex: number;
  specs: ChartSpec[];
  profiles: ColumnProfile[];
  cache: Record<string, InsightCacheEntry>;
  onCache: (key: string, value: InsightCacheEntry) => void;
  onHighlight: (columns: string[]) => void;
}

// ── Surface tokens ─────────────────────────────────────────────────────────────
const T = {
  surface:  'var(--builder-surface)',
  raised:   'var(--builder-surface-raised)',
  border:   'var(--builder-border)',
  text:     'var(--builder-text)',
  muted:    'var(--builder-text-muted)',
  label:    'var(--builder-text-label)',
  gold:     '#FDB515',
} as const;

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const SANS: React.CSSProperties = {
  fontFamily: "'Inter Tight', 'Inter', ui-sans-serif, sans-serif",
};
const SERIF: React.CSSProperties = {
  fontFamily: "'Source Serif 4', 'Georgia', ui-serif, serif",
};

// ── Shimmer skeleton card ─────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      style={{
        background: T.raised,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 12,
      }}
    >
      {/* kind row */}
      <div
        className="animate-pulse"
        style={{
          height: 10,
          width: '60%',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.06)',
          marginBottom: 10,
        }}
      />
      {/* gold rule */}
      <div style={{ height: 1, background: 'rgba(253,181,21,0.25)', marginBottom: 12 }} />
      {/* headline */}
      <div
        className="animate-pulse"
        style={{
          height: 14,
          width: '90%',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.06)',
          marginBottom: 6,
        }}
      />
      <div
        className="animate-pulse"
        style={{
          height: 14,
          width: '70%',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.06)',
          marginBottom: 12,
        }}
      />
      {/* body */}
      <div
        className="animate-pulse"
        style={{
          height: 11,
          width: '100%',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.04)',
          marginBottom: 4,
        }}
      />
      <div
        className="animate-pulse"
        style={{
          height: 11,
          width: '80%',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.04)',
        }}
      />
    </div>
  );
}

// ── Individual insight card (house signature) ─────────────────────────────────
function InsightCard({
  insight,
  onHighlight,
}: {
  insight: InsightItem;
  onHighlight: (columns: string[]) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        background: T.surface,
        padding: 16,
        marginBottom: 12,
      }}
    >
      {/* kind label + confidence badge */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            ...MONO,
            fontSize: 10,
            color: T.label,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          INSIGHT · {insight.kind.toUpperCase()}
        </span>
        <span
          style={{
            ...MONO,
            fontSize: 10,
            color: T.label,
            border: `1px solid ${T.border}`,
            borderRadius: 3,
            padding: '1px 5px',
            letterSpacing: '0.06em',
          }}
        >
          {insight.confidence.toUpperCase()}
        </span>
      </div>

      {/* gold rule */}
      <div style={{ width: '100%', height: 1, background: T.gold, marginBottom: 12 }} />

      {/* headline — Source Serif 4 italic, clickable */}
      <p
        style={{
          ...SERIF,
          fontStyle: 'italic',
          fontSize: 15,
          color: T.text,
          lineHeight: 1.4,
          marginBottom: 8,
          cursor: 'pointer',
          margin: '0 0 8px 0',
        }}
        onClick={() => onHighlight(insight.columns)}
        title="Click to highlight related charts"
      >
        {insight.headline}
      </p>

      {/* body — Inter Tight */}
      <p
        style={{
          ...SANS,
          fontSize: 13,
          color: T.muted,
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        {insight.body}
      </p>
    </div>
  );
}

// ── Payload helper — trim profiles before sending to stay under prompt budget ──
function slimProfiles(profiles: ColumnProfile[]): ColumnProfile[] {
  return profiles.slice(0, 30).map(p => {
    const slimmed: ColumnProfile = {
      name: p.name,
      declaredType: p.declaredType,
      kind: p.kind,
      cardinality: p.cardinality,
      nullRate: p.nullRate,
    };
    if (p.min !== undefined) slimmed.min = p.min;
    if (p.max !== undefined) slimmed.max = p.max;
    if (p.stats) slimmed.stats = p.stats;
    if (p.sorted) slimmed.sorted = p.sorted;
    // Only include topValues for categorical/boolean; cap at 3 entries
    if (p.topValues && (p.kind === 'categorical' || p.kind === 'boolean')) {
      slimmed.topValues = p.topValues.slice(0, 3);
    }
    return slimmed;
  });
}

// ── InsightRail ───────────────────────────────────────────────────────────────
export function InsightRail({
  result,
  resultIndex,
  specs,
  profiles,
  cache,
  onCache,
  onHighlight,
}: InsightRailProps) {
  const cacheKey = String(resultIndex);
  const cacheEntry = cache[cacheKey];

  // Track the in-flight RAF handle so we can cancel on cleanup
  const rafRef = useRef<number | null>(null);

  const fetchInsights = React.useCallback(() => {
    onCache(cacheKey, 'loading');

    // Wait for dashboard to paint before making the API call
    rafRef.current = requestAnimationFrame(() => {
      const sampleRows = result.rows.slice(0, 20);
      const specsPayload = specs.map(s => ({
        kind: s.kind,
        rationale: s.rationale,
        x: s.x,
        y: s.y,
      }));

      // If we have a persistedId, first check the DB for cached insights (zero LLM cost)
      const dbCheck = result.persistedId
        ? fetch(`/api/agent-lab/studio/insights?resultId=${result.persistedId}`)
            .then(r => r.ok ? r.json() as Promise<InsightResult> : null)
            .then((res: InsightResult | null) => {
              if (res && Array.isArray(res.insights) && res.insights.length > 0) {
                return res; // cache hit — skip LLM
              }
              return null;
            })
            .catch(() => null)
        : Promise.resolve(null);

      dbCheck.then((cached: InsightResult | null) => {
        if (cached) {
          onCache(cacheKey, cached);
          return;
        }

        // No DB cache — generate via LLM
        fetch('/api/agent-lab/studio/insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profiles: slimProfiles(profiles),
            specs: specsPayload,
            sql: result.sql.slice(0, 2000),
            sampleRows,
            // Pass IDs so the server persists the result
            resultId: result.persistedId,
          }),
        })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<InsightResult>;
          })
          .then(data => {
            onCache(cacheKey, data);
          })
          .catch(err => {
            console.warn('[InsightRail] fetch failed', err);
            onCache(cacheKey, 'error');
          });
      });
    });
  }, [cacheKey, result, specs, profiles, onCache]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Cache hit — skip
    if (cache[cacheKey] !== undefined) return;

    fetchInsights();

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [resultIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    onCache(cacheKey, 'loading');
    requestAnimationFrame(() => {
      const sampleRows = result.rows.slice(0, 20);
      const specsPayload = specs.map(s => ({
        kind: s.kind,
        rationale: s.rationale,
        x: s.x,
        y: s.y,
      }));

      fetch('/api/agent-lab/studio/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: slimProfiles(profiles),
          specs: specsPayload,
          sql: result.sql.slice(0, 2000),
          sampleRows,
          resultId: result.persistedId,
        }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<InsightResult>;
        })
        .then(data => onCache(cacheKey, data))
        .catch(() => onCache(cacheKey, 'error'));
    });
  };

  // ── Render states ────────────────────────────────────────────────────────────
  const railStyle: React.CSSProperties = {
    width: 320,
    flexShrink: 0,
    borderLeft: `1px solid ${T.border}`,
    display: 'flex',
    flexDirection: 'column',
    background: T.surface,
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    borderBottom: `1px solid ${T.border}`,
    ...MONO,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: T.label,
  };

  // Loading state
  if (cacheEntry === 'loading') {
    return (
      <div style={railStyle}>
        <div style={headerStyle}>
          <span>AI INSIGHTS</span>
          <RefreshCw size={11} style={{ opacity: 0.3 }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  // Error state
  if (cacheEntry === 'error') {
    return (
      <div style={railStyle}>
        <div style={headerStyle}>
          <span>AI INSIGHTS</span>
          <button
            onClick={handleRetry}
            title="Retry"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <RefreshCw size={11} style={{ color: T.gold }} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '0 24px',
          }}
        >
          <span style={{ ...MONO, fontSize: 11, color: T.label, textTransform: 'uppercase', letterSpacing: '0.10em', textAlign: 'center' }}>
            INSIGHTS UNAVAILABLE
          </span>
          <button
            onClick={handleRetry}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              ...MONO,
              fontSize: 11,
              color: T.gold,
              textDecoration: 'underline',
              letterSpacing: '0.08em',
            }}
          >
            ↺ Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state — insights array present but empty
  if (cacheEntry && typeof cacheEntry === 'object' && cacheEntry.insights.length === 0) {
    return (
      <div style={railStyle}>
        <div style={headerStyle}>
          <span>AI INSIGHTS</span>
          <button
            onClick={handleRetry}
            title="Refresh insights"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <RefreshCw size={11} style={{ color: T.label, opacity: 0.6 }} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 24px',
          }}
        >
          <span style={{ ...MONO, fontSize: 11, color: T.label, textTransform: 'uppercase', letterSpacing: '0.10em', textAlign: 'center' }}>
            NO INSIGHTS GENERATED
          </span>
        </div>
      </div>
    );
  }

  // Loaded state with insights
  const loadedInsights = cacheEntry && typeof cacheEntry === 'object'
    ? cacheEntry.insights
    : [];

  return (
    <div style={railStyle}>
      <div style={headerStyle}>
        <span>AI INSIGHTS</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loadedInsights.length > 0 && (
            <span
              style={{
                ...MONO,
                fontSize: 9,
                color: T.gold,
                background: 'rgba(253,181,21,0.08)',
                border: '1px solid rgba(253,181,21,0.2)',
                borderRadius: 3,
                padding: '1px 5px',
                letterSpacing: '0.06em',
              }}
            >
              {loadedInsights.length}
            </span>
          )}
          <button
            onClick={handleRetry}
            title="Refresh insights"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
          >
            <RefreshCw size={11} style={{ color: T.label, opacity: 0.6 }} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loadedInsights.map((insight, i) => (
          <InsightCard
            key={i}
            insight={insight}
            onHighlight={onHighlight}
          />
        ))}
      </div>
    </div>
  );
}
