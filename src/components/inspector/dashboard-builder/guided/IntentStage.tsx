'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, ArrowRight, Check, Loader2, Database } from 'lucide-react';
import { useBuilderStore } from '../builder-store';
import { DisambiguationUnderline } from './DisambiguationUnderline';
import type { ResolvedIntent, IntentDisambiguation } from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';
const GREEN = '#34D399';
const VIOLET = '#C4B5FD';
const RED = '#F87171';
const MUTED = '#8892A4';

/** A governed starter topic, kept WITH provenance so it traces to a real row. */
interface StarterTopic {
  intentText: string;
  label: string;
  /** (sourceType, sourceId) is the unique key of the platform_nl_intent_embeddings row. */
  sourceType: string;
  sourceId: string;
}

interface ResolveResponse {
  modelId: string;
  modelName: string;
  terms: IntentDisambiguation[];
  fieldKinds: Record<string, 'measure' | 'dimension'>;
}

interface Props {
  /** The dashboard's confirmed/bound semantic model. */
  modelId: string;
  /** Advance to Stage 2 (Blueprint). Wired by the guided host. */
  onProceed?: (intent: ResolvedIntent) => void;
  /** Bail out of guided (e.g. to manual). */
  onCancel?: () => void;
}

/**
 * Guided Stage 1 — Intent. Prompts the DECISION, not the chart, seeds real
 * governed starter topics (never a blank box), resolves the model, disambiguates
 * terms into four visibly-distinct states, and emits a ResolvedIntent into
 * `guidedSession.intent` on the shared store. No chart proposals here.
 *
 * Model-binding timing (build-plan open question #3): DEFER-TO-FIRST-SAVE. Stage
 * 1 records `modelId` in the resolved intent (client state only) and mints NO
 * dashboard→model binding — the invariant "one dashboard = one model" is carried
 * in guidedSession until save, so we never leave an empty bound dashboard behind.
 */
export function IntentStage({ modelId, onProceed, onCancel }: Props) {
  const setIntent = useBuilderStore((s) => s.setIntent);

  const [topic, setTopic] = useState('');
  const [starters, setStarters] = useState<StarterTopic[]>([]);
  const [startersLoading, setStartersLoading] = useState(true);
  const [modelName, setModelName] = useState<string | null>(null);
  const [modelConfirmed, setModelConfirmed] = useState(false);

  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  // User-chosen candidate per term (term → candidateId) for ambiguous/not_governed.
  const [choices, setChoices] = useState<Record<string, string>>({});

  // ── Load governed starter topics (with provenance) + model name ────────────
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    setStartersLoading(true);
    (async () => {
      try {
        const [intentRes, defRes] = await Promise.all([
          fetch(`/api/inspector/semantic/${modelId}/intents?limit=5`),
          fetch(`/api/inspector/semantic/${modelId}/definitions`).catch(() => null),
        ]);
        if (intentRes.ok) {
          const json = (await intentRes.json()) as {
            intents?: Array<{ intentText: string; label: string; sourceType: string; sourceId: string }>;
          };
          if (!cancelled) {
            setStarters(
              (json.intents ?? [])
                .filter((i) => i.intentText?.trim() && i.sourceId)
                .map((i) => ({ intentText: i.intentText.trim(), label: i.label, sourceType: i.sourceType, sourceId: i.sourceId })),
            );
          }
        }
        if (defRes && defRes.ok) {
          const dj = (await defRes.json()) as { model?: { name?: string } };
          if (!cancelled) setModelName(dj.model?.name ?? null);
        }
      } catch {
        if (!cancelled) setStarters([]);
      } finally {
        if (!cancelled) setStartersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modelId]);

  // ── Resolve the topic against the governed catalog ──────────────────────────
  const handleResolve = useCallback(async () => {
    const t = topic.trim();
    if (!t || resolving) return;
    setResolving(true);
    setChoices({});
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/resolve-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t }),
      });
      if (res.ok) {
        const json = (await res.json()) as ResolveResponse;
        setResolved(json);
        if (json.modelName) setModelName(json.modelName);
      } else {
        setResolved({ modelId, modelName: modelName ?? modelId, terms: [], fieldKinds: {} });
      }
    } catch {
      setResolved({ modelId, modelName: modelName ?? modelId, terms: [], fieldKinds: {} });
    } finally {
      setResolving(false);
    }
  }, [topic, resolving, modelId, modelName]);

  // Merge server resolutions with the user's live choices.
  const mergedTerms = useMemo<IntentDisambiguation[]>(() => {
    if (!resolved) return [];
    return resolved.terms.map((d) => (choices[d.term] ? { ...d, chosenId: choices[d.term] } : d));
  }, [resolved, choices]);

  // Relevant governed ids = matched terms + ambiguous terms once chosen. A
  // not_governed choice is NOT governed, so it never counts here (it stays in
  // disambiguations for the Teach nudge).
  const { relevantMeasureIds, relevantDimensionIds } = useMemo(() => {
    const meas: string[] = [];
    const dims: string[] = [];
    const kinds = resolved?.fieldKinds ?? {};
    for (const d of mergedTerms) {
      if (d.resolution !== 'matched' && d.resolution !== 'ambiguous') continue;
      const id = d.chosenId;
      if (!id) continue;
      if (kinds[id] === 'measure') meas.push(id);
      else if (kinds[id] === 'dimension') dims.push(id);
    }
    return { relevantMeasureIds: [...new Set(meas)], relevantDimensionIds: [...new Set(dims)] };
  }, [mergedTerms, resolved]);

  const unresolvedAmbiguous = mergedTerms.some((d) => d.resolution === 'ambiguous' && !d.chosenId);

  const canProceed = !!resolved && modelConfirmed && topic.trim().length > 0 && !unresolvedAmbiguous;

  const handleUseIntent = useCallback(() => {
    if (!canProceed || !resolved) return;
    const intent: ResolvedIntent = {
      modelId,
      topic: topic.trim(),
      relevantMeasureIds,
      relevantDimensionIds,
      disambiguations: mergedTerms,
    };
    setIntent(intent);
    onProceed?.(intent);
  }, [canProceed, resolved, modelId, topic, relevantMeasureIds, relevantDimensionIds, mergedTerms, setIntent, onProceed]);

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Decision prompt ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color={GOLD} />
          <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: GOLD }}>
            Guided · Step 1 · Intent
          </span>
        </div>
        <h2 style={{ ...MONO, fontSize: 17, lineHeight: 1.4, color: 'var(--wb-ink, #E6ECF5)', margin: 0, fontWeight: 600 }}>
          What should this dashboard help you understand or decide?
        </h2>
        <p style={{ ...MONO, fontSize: 11, color: MUTED, margin: 0, lineHeight: 1.5 }}>
          Describe the decision — not the chart. We’ll ground it in your governed metrics.
        </p>
      </div>

      {/* ── Topic input ─────────────────────────────────────────────────────── */}
      <textarea
        value={topic}
        onChange={(e) => { setTopic(e.target.value); setResolved(null); }}
        placeholder="e.g. Which vessels and root causes drive most accidents this year?"
        rows={3}
        style={{
          ...MONO, fontSize: 13, lineHeight: 1.5, padding: '12px 14px', borderRadius: 8,
          border: '1px solid rgba(136,146,164,0.3)', background: 'rgba(0,0,0,0.2)',
          color: 'var(--wb-ink, #E6ECF5)', resize: 'vertical', outline: 'none',
        }}
      />

      {/* ── Starter topics — governed questions only, each traceable to a real
             platform_nl_intent_embeddings row (source_type, source_id). ────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
          Starter topics — questions your org has governed
        </span>
        {startersLoading ? (
          <span style={{ ...MONO, fontSize: 10, color: MUTED }}>Reading the model…</span>
        ) : starters.length === 0 ? (
          <p style={{ ...MONO, fontSize: 11, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            No governed questions yet for this model. Type your own above — or govern one in Teach so it seeds the next person’s blank canvas.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {starters.map((st) => (
              <button
                key={`${st.sourceType}:${st.sourceId}`}
                onClick={() => { setTopic(st.intentText); setResolved(null); }}
                // Provenance surfaced for traceability (acceptance #2): this chip
                // is backed by a specific governed embedding row.
                data-intent-source-type={st.sourceType}
                data-intent-source-id={st.sourceId}
                title={`Governed question · ${st.label} · ${st.sourceType}:${st.sourceId}`}
                style={{
                  ...MONO, fontSize: 11, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 11px', borderRadius: 16, border: '1px solid rgba(253,181,21,0.25)',
                  background: 'rgba(253,181,21,0.05)', color: 'var(--wb-ink, #E6ECF5)', cursor: 'pointer',
                }}
              >
                <Sparkles size={11} color={GOLD} style={{ flexShrink: 0 }} />
                {st.intentText}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Resolve button ──────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={handleResolve}
          disabled={!topic.trim() || resolving}
          style={{
            ...MONO, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6,
            border: 'none', background: topic.trim() ? GOLD : 'rgba(253,181,21,0.3)', color: '#0D1B2A',
            cursor: topic.trim() && !resolving ? 'pointer' : 'default', fontWeight: 500,
          }}
        >
          {resolving ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          {resolving ? 'Resolving…' : 'Resolve against my metrics'}
        </button>
      </div>

      {/* ── Resolution result ───────────────────────────────────────────────── */}
      {resolved && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid rgba(136,146,164,0.15)', paddingTop: 18 }}>
          {/* Model confirm strip — one dashboard = one model. */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 6,
              border: `1px solid ${modelConfirmed ? 'rgba(52,211,153,0.4)' : 'rgba(147,197,253,0.3)'}`,
              background: modelConfirmed ? 'rgba(52,211,153,0.06)' : 'rgba(147,197,253,0.05)',
            }}
          >
            <Database size={14} color={modelConfirmed ? GREEN : '#93C5FD'} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ ...MONO, fontSize: 11, color: 'var(--wb-ink, #E6ECF5)' }}>
                Reads from <strong>{modelName ?? resolved.modelName ?? 'this model'}</strong>
              </span>
              <span style={{ ...MONO, fontSize: 9, color: MUTED }}>One dashboard = one semantic model.</span>
            </div>
            <button
              onClick={() => setModelConfirmed((c) => !c)}
              style={{
                ...MONO, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 5,
                border: `1px solid ${modelConfirmed ? GREEN : 'rgba(147,197,253,0.4)'}`,
                background: modelConfirmed ? 'rgba(52,211,153,0.1)' : 'transparent',
                color: modelConfirmed ? GREEN : '#93C5FD', cursor: 'pointer',
              }}
            >
              {modelConfirmed ? <><Check size={11} />Confirmed</> : 'Confirm model'}
            </button>
          </div>

          {/* Term resolution — the topic re-rendered with per-term underlines. */}
          {mergedTerms.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>
                How your terms resolved
              </span>
              <div style={{ ...MONO, fontSize: 13, lineHeight: 2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {mergedTerms.map((d, i) => (
                  <DisambiguationUnderline
                    key={`${d.term}:${i}`}
                    disambig={d}
                    onChoose={(term, id) => setChoices((c) => ({ ...c, [term]: id }))}
                    onDefineInTeach={(term) => window.open(`/inspector?teach=${encodeURIComponent(term)}`, '_blank')}
                  />
                ))}
              </div>
              <Legend />
            </div>
          )}
          {mergedTerms.length === 0 && (
            <p style={{ ...MONO, fontSize: 11, color: MUTED, margin: 0 }}>
              No specific governed terms detected in your topic — that’s fine, Stage 2 will still propose from the governed catalog.
            </p>
          )}

          {/* ── Advance ─────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <button
              onClick={handleUseIntent}
              disabled={!canProceed}
              title={
                !modelConfirmed ? 'Confirm the model first'
                  : unresolvedAmbiguous ? 'Resolve the ambiguous term(s) first'
                    : undefined
              }
              style={{
                ...MONO, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 6,
                border: 'none', background: canProceed ? GOLD : 'rgba(253,181,21,0.3)', color: '#0D1B2A',
                cursor: canProceed ? 'pointer' : 'default', fontWeight: 500,
              }}
            >
              Use this intent<ArrowRight size={13} />
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                style={{ ...MONO, fontSize: 10, color: MUTED, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Switch to manual
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Legend for the four distinct resolution states. */
function Legend() {
  const items: Array<{ c: string; deco: string; label: string }> = [
    { c: GREEN, deco: 'underline', label: 'matched' },
    { c: GOLD, deco: 'underline dashed', label: 'ambiguous — pick one' },
    { c: VIOLET, deco: 'underline dotted', label: 'not governed — define in Teach' },
    { c: RED, deco: 'underline wavy', label: 'unrecognized' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
      {items.map((it) => (
        <span key={it.label} style={{ ...MONO, fontSize: 9, color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ textDecoration: it.deco, textDecorationColor: it.c, color: it.c }}>abc</span>
          {it.label}
        </span>
      ))}
    </div>
  );
}
