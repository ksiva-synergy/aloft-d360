'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Ruler } from 'lucide-react';
import { SemanticGovernancePanel } from '@/components/inspector/SemanticGovernancePanel';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const SANS: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
const GOLD = '#FDB515';
const MUTED = '#8892A4';
const BORDER_SUBTLE = 'rgba(253,181,21,0.15)';

interface ModelSummary { id: string; name: string; status: string }

/**
 * /agent-lab/metrics — the always-available front door to the metric authoring
 * + governance surface (W1).
 *
 * The same SemanticGovernancePanel that lives in the Inspector right-pane is
 * mounted here, but sourced org-wide instead of from a session candidate model:
 * My Drafts and What I've Taught aggregate across every model the user has
 * contributed to (no active Inspector session required), while the governance
 * queue + authoring target follow the model picker below. This is what gives the
 * Define-a-Metric / drafts / vocabulary stack a real, discoverable home instead
 * of only appearing mid-flow when a candidate model happens to exist.
 */
export default function MetricsPage() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/inspector/semantic/models')
      .then((r) => (r.ok ? r.json() as Promise<{ models: ModelSummary[]; defaultModelId: string | null }> : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        setModels(d.models ?? []);
        setSelected(d.defaultModelId);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load models'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusOrder = (s: string) => (s === 'governed' ? 0 : s === 'candidate' ? 1 : 2);
  const sortedModels = [...models].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wb-canvas)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '16px 24px 12px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ruler size={18} color={GOLD} />
            <div>
              <div style={{ ...SANS, fontSize: 16, fontWeight: 600, color: 'var(--wb-ink)' }}>Metrics</div>
              <div style={{ ...MONO, fontSize: 10, color: MUTED, marginTop: 2 }}>
                Define metrics, review your drafts, and see everything you&apos;ve taught — across every model.
              </div>
            </div>
          </div>

          {/* Model picker — governs the governance queue + the authoring target. */}
          {sortedModels.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...MONO, fontSize: 10, color: MUTED }}>
              <span style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Model</span>
              <select
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value || null)}
                style={{
                  ...MONO, fontSize: 11, color: 'var(--wb-ink)',
                  background: 'rgba(0,0,0,0.2)', border: `1px solid ${BORDER_SUBTLE}`,
                  borderRadius: 4, padding: '4px 8px', outline: 'none',
                }}
              >
                {sortedModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.status}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ ...MONO, fontSize: 11, color: MUTED }}>LOADING METRICS…</span>
        </div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ ...MONO, fontSize: 11, color: '#f43f5e' }}>ERROR: {error}</span>
          <button
            onClick={load}
            style={{ ...MONO, fontSize: 10, color: GOLD, background: 'transparent', border: `1px solid ${BORDER_SUBTLE}`, borderRadius: 4, padding: '4px 12px', cursor: 'pointer' }}
          >
            RETRY
          </button>
        </div>
      ) : selected ? (
        // Org-scoped drafts + contributions, with the selected model's governance
        // queue + authoring target. One component, two mount sites (W1).
        <SemanticGovernancePanel
          modelId={selected}
          authoringScope={{ kind: 'org' }}
          authorModelId={selected}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{
            ...MONO, fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 1.7, maxWidth: 420,
            border: `1px dashed ${BORDER_SUBTLE}`, borderRadius: 8, padding: '28px 24px',
          }}>
            No semantic model exists for your org yet.<br />
            Harvest one in the <span style={{ color: GOLD }}>Inspector</span> to start authoring metrics.
          </div>
        </div>
      )}
    </div>
  );
}
