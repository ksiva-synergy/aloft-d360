'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, BarChart3 } from 'lucide-react';
import {
  generateStarterPrompts,
  WHAT_IS_THIS_DATA_PROMPT,
  type StarterDimension,
  type StarterMeasure,
} from '@/lib/dashboards/empty-states';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';
const MUTED = '#8892A4';

interface EmptyStatePromptsProps {
  /** Governed model to generate prompts from. Omit/null → generic welcome. */
  modelId?: string | null;
  /** Heading shown above the prompts. */
  title?: string;
  /** Called with the chosen prompt text (navigate, prefill, or submit). */
  onPromptClick: (prompt: string) => void;
  /** Prepend the "What is this data?" spotter prompt (chat empty state). */
  includeWhatIsThis?: boolean;
  /** Trailing hint under the prompts, e.g. "Or ask Inspector anything →". */
  footerHint?: string;
}

/**
 * Generative empty state (Phase 3B, Deliverable 4). Given a governed model, it
 * loads the model's definitions and renders 3–5 deterministic starter prompts
 * (see lib/dashboards/empty-states.ts) as clickable chips, so an empty dashboard
 * or a fresh Inspector session is never a blank slate.
 *
 * Shared by InspectorShell (chat empty state), DashboardViewer, and
 * DashboardBuilder. With no modelId it degrades to a generic welcome.
 */
export function EmptyStatePrompts({
  modelId,
  title = 'Get started',
  onPromptClick,
  includeWhatIsThis = false,
  footerHint,
}: EmptyStatePromptsProps) {
  const [prompts, setPrompts] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!modelId);

  useEffect(() => {
    if (!modelId) { setPrompts([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/inspector/semantic/${modelId}/definitions`);
        if (!res.ok) { if (!cancelled) setPrompts([]); return; }
        const json = (await res.json()) as {
          entities?: Array<{
            dimensions: Array<{ id: string; dimension_label: string; dimension_type: string }>;
            measures: Array<{ id: string; measure_label: string }>;
          }>;
        };
        const dims: StarterDimension[] = [];
        const measures: StarterMeasure[] = [];
        for (const e of json.entities ?? []) {
          for (const d of e.dimensions) dims.push({ id: d.id, label: d.dimension_label, dimension_type: d.dimension_type });
          for (const m of e.measures) measures.push({ id: m.id, label: m.measure_label });
        }
        if (!cancelled) setPrompts(generateStarterPrompts(dims, measures));
      } catch {
        if (!cancelled) setPrompts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modelId]);

  // ── No model associated → generic welcome ───────────────────────────────────
  if (!modelId) {
    return (
      <Frame>
        <Heading title="Ask Inspector anything about your data" />
        <p style={{ ...MONO, fontSize: 11, color: MUTED, lineHeight: 1.6, margin: 0, maxWidth: 420, textAlign: 'center' }}>
          I can query your warehouse, build charts, and help you explore. Ask a question below to begin.
        </p>
      </Frame>
    );
  }

  const finalPrompts = includeWhatIsThis ? [WHAT_IS_THIS_DATA_PROMPT, ...prompts] : prompts;

  return (
    <Frame>
      <Heading title={title} />
      {loading ? (
        <span style={{ ...MONO, fontSize: 10, color: MUTED }}>Reading the model…</span>
      ) : finalPrompts.length === 0 ? (
        <p style={{ ...MONO, fontSize: 11, color: MUTED, lineHeight: 1.6, margin: 0, maxWidth: 420, textAlign: 'center' }}>
          This model has no governed fields yet. Ask Inspector a question to explore the warehouse directly.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 420 }}>
          {finalPrompts.map((p) => (
            <button
              key={p}
              onClick={() => onPromptClick(p)}
              style={{
                ...MONO,
                fontSize: 12,
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '9px 12px',
                borderRadius: 6,
                border: '1px solid rgba(253,181,21,0.2)',
                background: 'rgba(253,181,21,0.04)',
                color: 'var(--wb-ink, #E6ECF5)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.background = 'rgba(253,181,21,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(253,181,21,0.2)'; e.currentTarget.style.background = 'rgba(253,181,21,0.04)'; }}
            >
              <BarChart3 size={13} color={GOLD} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
            </button>
          ))}
        </div>
      )}
      {footerHint && (
        <span style={{ ...MONO, fontSize: 10, color: MUTED, letterSpacing: '0.02em' }}>{footerHint}</span>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        padding: 24,
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      {children}
    </div>
  );
}

function Heading({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Sparkles size={15} color={GOLD} />
      <span style={{ ...MONO, fontSize: 12, letterSpacing: '0.04em', color: 'var(--wb-ink, #E6ECF5)' }}>{title}</span>
    </div>
  );
}
