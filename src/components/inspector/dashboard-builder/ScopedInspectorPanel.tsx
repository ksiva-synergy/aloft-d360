'use client';

/**
 * ScopedInspectorPanel
 *
 * A slide-out right panel that provides a mini Inspector experience scoped to
 * the dashboard's semantic model. Users can ask natural-language questions about
 * the data (e.g. "show accidents by vessel type this quarter") and get live
 * semantic charts back — exactly like the full Inspector, but pre-scoped to the
 * dashboard's model and without the multi-panel chrome.
 *
 * Results can be pinned to the dashboard using the same Pin mechanism as the
 * full Inspector's SemanticChartCard. The panel slides in from the right over
 * the builder/viewer without disrupting the layout.
 *
 * Uses useInspectorChat (the same hook as the full Inspector) so the semantic
 * chart pipeline, SSE streaming, and disambiguation are all fully functional.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Send, Loader2, Sparkles, RotateCcw, Pin,
} from 'lucide-react';
import { useInspectorChat } from '@/hooks/useInspectorChat';
import { SemanticChartCard } from '@/components/inspector/SemanticChartCard';
import { QueryProgressCard } from '@/components/inspector/QueryProgressCard';
import { DisambiguationCard } from '@/components/inspector/DisambiguationCard';
import {
  UI_FONT, ACCENT_AMBER, INK as INK_TOK, INK_MUTED, CARD_ELEVATED, BORDER, CANVAS,
} from '@/lib/dashboards/inspector-viz-tokens';

const GOLD = ACCENT_AMBER;
const MUTED = INK_MUTED;
const INK = INK_TOK;

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

interface Props {
  /** The dashboard's bound semantic model id — scopes all queries. */
  modelId: string;
  /** Dashboard name — shown in the panel header for context. */
  dashboardName?: string;
  /** Called when user clicks Pin on a chart, to add it as a widget. */
  onPinChart?: (chartMessageId: string) => void;
  /** Close handler. */
  onClose: () => void;
}

export function ScopedInspectorPanel({ modelId, dashboardName, onPinChart, onClose }: Props) {
  // Prefix every user message with the model scope so the inspector routes
  // queries through the right semantic layer automatically.
  const scopePrefix = `[model:${modelId}] `;

  const insp = useInspectorChat({ sessionId: null, contextMode: 'harvested' });

  const [composer, setComposer] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [insp.messages, insp.semanticChartMessages, insp.queryProgress]);

  const handleSubmit = useCallback(() => {
    const text = composer.trim();
    if (!text || insp.isStreaming) return;
    // Prepend model scope so the full Inspector pipeline picks up the right model
    insp.send(scopePrefix + text);
    setComposer('');
  }, [composer, insp, scopePrefix]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Filter messages to show only user-facing ones (skip system/tool noise)
  const visibleMessages = insp.messages.filter(
    (m) => m.role === 'user' || (m.role === 'assistant' && m.content),
  );

  // Latest user question for SemanticChartCard originalQuestion prop
  const latestUserQuestion = (() => {
    for (let i = insp.messages.length - 1; i >= 0; i--) {
      const m = insp.messages[i];
      if (m.role === 'user' && m.content) {
        // Strip the scope prefix for display
        return m.content.replace(/^\s*\[model:[^\]]*\]\s*/s, '').trim();
      }
    }
    return undefined;
  })();

  const isEmpty =
    visibleMessages.length === 0 &&
    insp.semanticChartMessages.length === 0 &&
    insp.disambiguations.length === 0 &&
    !insp.queryProgress;

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 40,
        width: 480,
        background: CARD_ELEVATED,
        borderLeft: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-16px 0 48px rgba(0,0,0,0.55)',
        fontFamily: UI_FONT,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: `1px solid ${tint(MUTED, 20)}`, flexShrink: 0,
        background: CANVAS,
      }}>
        <Sparkles size={14} color={GOLD} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: INK }}>
            Explore Data
          </div>
          {dashboardName && (
            <div style={{ fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dashboardName}
            </div>
          )}
        </div>
        <button
          onClick={() => insp.reset()}
          title="New session"
          style={{
            background: 'transparent', border: `1px solid ${tint(MUTED, 30)}`,
            borderRadius: 5, color: MUTED, cursor: 'pointer',
            padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontFamily: UI_FONT,
          }}
        >
          <RotateCcw size={11} /> Reset
        </button>
        <button
          onClick={onClose}
          aria-label="Close explore panel"
          style={{
            background: 'transparent', border: 'none', color: MUTED,
            cursor: 'pointer', padding: 4, display: 'inline-flex',
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Message thread ─────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {isEmpty && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, textAlign: 'center', padding: '32px 24px',
          }}>
            <Sparkles size={32} color={tint(GOLD, 40)} />
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, lineHeight: 1.4 }}>
              Ask questions about the data
            </div>
            <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6, maxWidth: 320 }}>
              Questions are scoped to this dashboard's semantic model.
              Ask about trends, breakdowns, comparisons — anything in the governed catalog.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 320 }}>
              {[
                'Show me accidents by root cause this year',
                'Which vessel type has the most incidents?',
                'Monthly injury trend for the last 6 months',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setComposer(suggestion)}
                  style={{
                    fontFamily: UI_FONT, fontSize: 11.5, color: MUTED, textAlign: 'left',
                    background: tint(MUTED, 6), border: `1px solid ${tint(MUTED, 20)}`,
                    borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = tint(MUTED, 12))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = tint(MUTED, 6))}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation messages */}
        {visibleMessages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
              gap: 8, alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
                background: m.role === 'user' ? tint(GOLD, 15) : tint(MUTED, 8),
                border: `1px solid ${m.role === 'user' ? tint(GOLD, 30) : tint(MUTED, 20)}`,
                fontSize: 12.5, color: INK, lineHeight: 1.6,
                fontFamily: UI_FONT,
              }}
            >
              {m.role === 'user'
                ? String(m.content ?? '').replace(/^\s*\[model:[^\]]*\]\s*/s, '')
                : String(m.content ?? '')}
            </div>
          </div>
        ))}

        {/* In-progress query indicator */}
        {insp.queryProgress && (
          <div style={{ paddingLeft: 8 }}>
            <QueryProgressCard progress={insp.queryProgress} />
          </div>
        )}

        {/* Disambiguation prompts */}
        {insp.disambiguations.map((d) => (
          <DisambiguationCard
            key={d.id}
            message={d}
            modelId={modelId}
            onChoose={(followUp) => insp.send(scopePrefix + followUp)}
          />
        ))}

        {/* Semantic chart results */}
        {insp.semanticChartMessages.map((msg) => (
          <div key={msg.id} style={{ position: 'relative' }}>
            <SemanticChartCard
              message={msg}
              echartsOption={msg.echartsOption}
              onRefine={(followUp) => insp.send(scopePrefix + followUp)}
              originalQuestion={latestUserQuestion}
            />
            {onPinChart && (
              <button
                onClick={() => onPinChart(msg.id)}
                title="Add to dashboard"
                style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 10,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 6,
                  background: tint(GOLD, 12), border: `1px solid ${tint(GOLD, 40)}`,
                  color: GOLD, cursor: 'pointer', fontFamily: UI_FONT, fontSize: 10.5,
                  fontWeight: 600,
                }}
              >
                <Pin size={11} /> Add to dashboard
              </button>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {insp.isStreaming && insp.semanticChartMessages.length === 0 && !insp.queryProgress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', color: MUTED, fontSize: 12 }}>
            <Loader2 size={13} className="spin" /> Thinking…
          </div>
        )}
      </div>

      {/* ── Composer ───────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, padding: '10px 14px',
        borderTop: `1px solid ${tint(MUTED, 20)}`,
        background: CANVAS,
      }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          background: tint(MUTED, 8), border: `1px solid ${tint(MUTED, 22)}`,
          borderRadius: 10, padding: '8px 10px',
        }}>
          <textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the data…"
            rows={1}
            disabled={insp.isStreaming}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: UI_FONT, fontSize: 13, color: INK, resize: 'none',
              lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
              opacity: insp.isStreaming ? 0.5 : 1,
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={insp.isStreaming ? insp.abort : handleSubmit}
            disabled={!insp.isStreaming && !composer.trim()}
            title={insp.isStreaming ? 'Stop' : 'Send (Enter)'}
            style={{
              background: insp.isStreaming ? tint('#F87171', 15) : composer.trim() ? GOLD : tint(MUTED, 20),
              border: 'none', borderRadius: 7,
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: insp.isStreaming || composer.trim() ? 'pointer' : 'default',
              color: insp.isStreaming ? '#F87171' : '#0D1B2A',
              flexShrink: 0, transition: 'background 0.1s',
            }}
          >
            {insp.isStreaming
              ? <span style={{ width: 10, height: 10, background: '#F87171', borderRadius: 2, display: 'block' }} />
              : <Send size={13} />
            }
          </button>
        </div>
        <div style={{ fontSize: 9.5, color: tint(MUTED, 60), marginTop: 5, textAlign: 'right' }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
