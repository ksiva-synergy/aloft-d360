'use client';

import React, { useState } from 'react';
import { AlertTriangle, HelpCircle, Sparkles } from 'lucide-react';
import type { IntentDisambiguation } from '@/lib/dashboards/guided-types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

// Four visibly-distinct states — deliberately NOT one red underline.
const GREEN = '#34D399'; // matched — resolved to one governed field
const GOLD = '#FDB515'; // ambiguous — multiple governed candidates → chooser
const VIOLET = '#C4B5FD'; // not_governed — real field, not promoted → Teach nudge
const RED = '#F87171'; // unrecognized — genuinely no match anywhere
const MUTED = '#8892A4';

/** Underline treatment per resolution state — each state reads differently. */
function underlineStyle(d: IntentDisambiguation): React.CSSProperties {
  switch (d.resolution) {
    case 'matched':
      return { textDecoration: 'underline', textDecorationColor: GREEN, textDecorationThickness: 2, color: 'var(--wb-ink, #E6ECF5)' };
    case 'ambiguous':
      return { textDecoration: 'underline dashed', textDecorationColor: GOLD, textUnderlineOffset: 3, color: GOLD, cursor: 'pointer' };
    case 'not_governed':
      return { textDecoration: 'underline dotted', textDecorationColor: VIOLET, textUnderlineOffset: 3, color: VIOLET, cursor: 'pointer' };
    case 'unrecognized':
    default:
      // A top-K-capped-but-possibly-real match must NOT look like a hard miss.
      return d.cappedByTopK
        ? { textDecoration: 'underline dotted', textDecorationColor: GOLD, textUnderlineOffset: 3, color: GOLD, cursor: 'help' }
        : { textDecoration: 'underline wavy', textDecorationColor: RED, textUnderlineOffset: 3, color: RED };
  }
}

function stateLabel(d: IntentDisambiguation): string {
  switch (d.resolution) {
    case 'matched':
      return `Matched → ${d.candidates[0]?.label ?? ''}`;
    case 'ambiguous':
      return `${d.candidates.length} governed fields — pick one`;
    case 'not_governed':
      return 'Defined but not governed yet — govern it in Teach';
    case 'unrecognized':
    default:
      return d.cappedByTopK
        ? 'No exact governed match — search may be truncated (top-K cap)'
        : 'No matching governed field';
  }
}

interface Props {
  disambig: IntentDisambiguation;
  /** Called when the user resolves an ambiguous term to a candidate id. */
  onChoose: (term: string, candidateId: string) => void;
  /** Deep-link into Teach to define/govern the term. */
  onDefineInTeach?: (term: string) => void;
}

/**
 * Renders a single term from the topic with a state-specific underline and an
 * on-click popover. Four states, four treatments (Task 4): a capped-but-real
 * match (`cappedByTopK`) is rendered as a distinct amber "may be truncated"
 * note, never the hard red 'unrecognized'.
 */
export function DisambiguationUnderline({ disambig: d, onChoose, onDefineInTeach }: Props) {
  const [open, setOpen] = useState(false);
  const interactive = d.resolution === 'ambiguous' || d.resolution === 'not_governed';
  const chosen = d.chosenId ? d.candidates.find((c) => c.id === d.chosenId) : null;

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={{ ...MONO, ...underlineStyle(d) }}
        title={stateLabel(d)}
        onClick={interactive ? () => setOpen((o) => !o) : undefined}
      >
        {chosen ? chosen.label : d.term}
      </span>

      {open && interactive && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            zIndex: 20,
            minWidth: 240,
            maxWidth: 320,
            background: 'var(--builder-surface-raised, #14202E)',
            border: `1px solid ${d.resolution === 'ambiguous' ? 'rgba(253,181,21,0.35)' : 'rgba(196,181,253,0.35)'}`,
            borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {d.resolution === 'ambiguous' ? (
              <HelpCircle size={11} color={GOLD} />
            ) : (
              <AlertTriangle size={11} color={VIOLET} />
            )}
            <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: d.resolution === 'ambiguous' ? GOLD : VIOLET }}>
              {d.resolution === 'ambiguous' ? `Which "${d.term}"?` : `"${d.term}" isn’t governed`}
            </span>
          </div>

          {/* Candidates — {id,label,description} per the pinned contract. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {d.candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => { onChoose(d.term, c.id); setOpen(false); }}
                style={{
                  ...MONO,
                  fontSize: 11,
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: `1px solid ${c.id === d.chosenId ? GREEN : 'rgba(136,146,164,0.25)'}`,
                  background: c.id === d.chosenId ? 'rgba(52,211,153,0.08)' : 'transparent',
                  color: 'var(--wb-ink, #E6ECF5)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {c.id === d.chosenId && <Sparkles size={9} color={GREEN} />}
                  {c.label}
                </span>
                {c.description && (
                  <span style={{ fontSize: 9, color: MUTED, lineHeight: 1.4 }}>{c.description}</span>
                )}
              </button>
            ))}
          </div>

          {d.resolution === 'not_governed' && onDefineInTeach && (
            <button
              onClick={() => { onDefineInTeach(d.term); setOpen(false); }}
              style={{
                ...MONO,
                fontSize: 10,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '6px 8px',
                borderRadius: 4,
                border: `1px solid ${VIOLET}`,
                background: 'rgba(196,181,253,0.10)',
                color: VIOLET,
                cursor: 'pointer',
              }}
            >
              Define it in Teach →
            </button>
          )}
        </div>
      )}
    </span>
  );
}
