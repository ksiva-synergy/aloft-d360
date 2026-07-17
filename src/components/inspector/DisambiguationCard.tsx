'use client';

import React, { useState, useCallback } from 'react';
import { HelpCircle, Search, ChevronDown } from 'lucide-react';
import type { DisambiguationMessage, DisambiguationCandidate } from '@/hooks/useInspectorChat';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};
const GOLD = '#FDB515';
const BLUE = '#93C5FD';
const MUTED = '#8892A4';

interface DisambiguationCardProps {
  message: DisambiguationMessage;
  /** Model whose full definition list backs "search all fields". Null → no search. */
  modelId: string | null;
  /** Sends a clarifying follow-up message to the chat (e.g. via useInspectorChat.send). */
  onChoose: (followUp: string) => void;
}

/** A governed field surfaced in the "search all fields" fallback list. */
interface AllField {
  id: string;
  label: string;
  type: 'dimension' | 'measure';
}

/** Colour tokens per match relevance — blue (strong), amber (partial), gray (none). */
function relevanceStyle(relevance: DisambiguationCandidate['relevance']): {
  border: string;
  bg: string;
  color: string;
} {
  switch (relevance) {
    case 'exact':
      return { border: 'rgba(147,197,253,0.5)', bg: 'rgba(147,197,253,0.10)', color: BLUE };
    case 'partial':
      return { border: 'rgba(253,181,21,0.4)', bg: 'rgba(253,181,21,0.08)', color: GOLD };
    default:
      return { border: 'rgba(136,146,164,0.35)', bg: 'rgba(136,146,164,0.08)', color: MUTED };
  }
}

/** Compose the follow-up message a chip click sends back to the agent. */
function messageFor(label: string, id: string): string {
  return `Use ${label} (${id})`;
}

/**
 * Renders an agent-raised disambiguation prompt (Phase 3B). The agent calls the
 * emit_disambiguation tool when a term is ambiguous (maps to several governed
 * fields) or unrecognized (maps to none); this card turns that structured
 * response into clickable choices instead of prose the user has to retype.
 *
 * Clicking a candidate sends "Use <label> (<id>)" back to the chat, which the
 * agent then treats as an unambiguous instruction and proceeds to chart. The
 * "None of these — search all fields" affordance loads the full governed model
 * so the user can pick a field the agent did not surface.
 */
export function DisambiguationCard({ message, modelId, onChoose }: DisambiguationCardProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [allFields, setAllFields] = useState<AllField[] | null>(null);
  const [loadingFields, setLoadingFields] = useState(false);
  const [query, setQuery] = useState('');
  const [resolved, setResolved] = useState(false);

  const loadAllFields = useCallback(async () => {
    if (!modelId || allFields || loadingFields) return;
    setLoadingFields(true);
    try {
      const res = await fetch(`/api/inspector/semantic/${modelId}/definitions`);
      if (!res.ok) { setAllFields([]); return; }
      const json = (await res.json()) as {
        entities?: Array<{
          dimensions: Array<{ id: string; dimension_label: string }>;
          measures: Array<{ id: string; measure_label: string }>;
        }>;
      };
      const fields: AllField[] = [];
      for (const e of json.entities ?? []) {
        for (const d of e.dimensions) fields.push({ id: d.id, label: d.dimension_label, type: 'dimension' });
        for (const m of e.measures) fields.push({ id: m.id, label: m.measure_label, type: 'measure' });
      }
      setAllFields(fields);
    } catch {
      setAllFields([]);
    } finally {
      setLoadingFields(false);
    }
  }, [modelId, allFields, loadingFields]);

  const choose = useCallback(
    (label: string, id: string) => {
      if (resolved) return;
      setResolved(true);
      onChoose(messageFor(label, id));
    },
    [onChoose, resolved],
  );

  const filtered = (allFields ?? []).filter((f) =>
    f.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(147,197,253,0.25)',
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 12,
        opacity: resolved ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid rgba(147,197,253,0.12)',
        }}
      >
        <HelpCircle size={12} color={BLUE} />
        <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.06em', color: BLUE, textTransform: 'uppercase', flex: 1 }}>
          Which did you mean{message.originalTerm ? ` by "${message.originalTerm}"` : ''}?
        </span>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Agent's natural-language explanation */}
        {message.message && (
          <p style={{ ...MONO, fontSize: 11, lineHeight: 1.5, color: 'var(--wb-ink-dim, #B8C1CF)', margin: 0 }}>
            {message.message}
          </p>
        )}

        {/* Candidate chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {message.candidates.map((c) => {
            const s = relevanceStyle(c.relevance);
            return (
              <button
                key={`${c.type}:${c.id}`}
                onClick={() => choose(c.label, c.id)}
                disabled={resolved}
                title={`${c.type} · ${c.relevance} match · ${c.id}`}
                style={{
                  ...MONO,
                  fontSize: 10,
                  letterSpacing: '0.02em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 14,
                  border: `1px solid ${s.border}`,
                  background: s.bg,
                  color: s.color,
                  cursor: resolved ? 'default' : 'pointer',
                }}
              >
                {c.label}
                <span style={{ fontSize: 8, opacity: 0.7, textTransform: 'uppercase' }}>{c.type}</span>
              </button>
            );
          })}
        </div>

        {/* None of these — search all fields */}
        {modelId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => {
                setSearchOpen((o) => !o);
                if (!searchOpen) loadAllFields();
              }}
              disabled={resolved}
              style={{
                ...MONO,
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                alignSelf: 'flex-start',
                padding: '3px 0',
                background: 'transparent',
                border: 'none',
                color: MUTED,
                cursor: resolved ? 'default' : 'pointer',
              }}
            >
              <ChevronDown size={11} style={{ transform: searchOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              None of these — search all fields
            </button>

            {searchOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(74,96,128,0.35)', borderRadius: 4, padding: '4px 8px', background: 'rgba(0,0,0,0.2)' }}>
                  <Search size={11} color={MUTED} />
                  <input
                    type="text"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter governed fields…"
                    style={{ ...MONO, fontSize: 11, flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--wb-text)' }}
                  />
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {loadingFields && (
                    <span style={{ ...MONO, fontSize: 10, color: MUTED, padding: '4px 2px' }}>Loading fields…</span>
                  )}
                  {!loadingFields && filtered.length === 0 && (
                    <span style={{ ...MONO, fontSize: 10, color: MUTED, padding: '4px 2px' }}>No matching fields.</span>
                  )}
                  {filtered.map((f) => (
                    <button
                      key={`${f.type}:${f.id}`}
                      onClick={() => choose(f.label, f.id)}
                      disabled={resolved}
                      style={{
                        ...MONO,
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '5px 8px',
                        borderRadius: 3,
                        border: '1px solid transparent',
                        background: 'transparent',
                        color: 'var(--wb-ink-dim, #B8C1CF)',
                        cursor: resolved ? 'default' : 'pointer',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(147,197,253,0.35)'; e.currentTarget.style.background = 'rgba(147,197,253,0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</span>
                      <span style={{ fontSize: 8, opacity: 0.6, textTransform: 'uppercase', flexShrink: 0 }}>{f.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
