'use client';

import React from 'react';
import { Search, X, AlertCircle, HelpCircle, CheckCircle2, PlusCircle } from 'lucide-react';
import { useCatalogStore } from './catalog-store';
import type { IntentDisambiguation } from '@/lib/dashboards/guided-types';
import { MONO, SANS, MUTED, INK, INK_DIM, BORDER, GOLD } from './mc-ui';

/**
 * Search + resolution strip. The input live-filters the table by label/synonym.
 * On submit it calls the REAL 4-state resolver (POST /[modelId]/resolve-intent)
 * — no fabricated domain-type chips. States:
 *   matched      → solid chip; click narrows the table to that definition.
 *   not_governed → amber chip (recognized but candidate) + "Govern it".
 *   ambiguous    → "did you mean:" option chips (inline).
 *   unrecognized → refusal: "isn't defined … I won't fabricate a result" + Define it.
 * resolve-intent requires a governed model; otherwise the strip stays a plain
 * filter with an honest note.
 */

const DEMO = 'Spar Liberian tankers EEXI';

interface Props {
  onDefine: (term: string) => void;
}

export function SearchStrip({ onDefine }: Props) {
  const raw = useCatalogStore((s) => s.search.raw);
  const setSearchRaw = useCatalogStore((s) => s.setSearchRaw);
  const resolving = useCatalogStore((s) => s.search.resolving);
  const resolveError = useCatalogStore((s) => s.search.resolveError);
  const resolvedTerms = useCatalogStore((s) => s.search.resolvedTerms);
  const setResolving = useCatalogStore((s) => s.setResolving);
  const setResolved = useCatalogStore((s) => s.setResolved);
  const setResolveError = useCatalogStore((s) => s.setResolveError);
  const chooseAmbiguous = useCatalogStore((s) => s.chooseAmbiguous);
  const setActiveDefIds = useCatalogStore((s) => s.setActiveDefIds);
  const setThemeFacet = useCatalogStore((s) => s.setThemeFacet);
  const clearSearch = useCatalogStore((s) => s.clearSearch);
  const activeModelId = useCatalogStore((s) => s.activeModelId);
  const activeModelGoverned = useCatalogStore((s) => s.activeModelGoverned);
  const rows = useCatalogStore((s) => s.rows);

  const resolve = async () => {
    if (!activeModelId || !activeModelGoverned || !raw.trim()) return;
    setResolving(true);
    try {
      const r = await fetch(`/api/inspector/semantic/${activeModelId}/resolve-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: raw }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = (await r.json()) as { terms: IntentDisambiguation[] };
      setResolved(d.terms ?? [], true);
    } catch (e: unknown) {
      setResolveError(e instanceof Error ? e.message : 'Resolution failed');
    }
  };

  // Narrow table + jump coverage to a resolved definition.
  const applyDef = (defId: string) => {
    setActiveDefIds([defId]);
    const row = rows.find((r) => r.id === defId);
    if (row) setThemeFacet(row.theme);
  };

  return (
    <div style={{ flexShrink: 0, padding: '12px 20px', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 640 }}>
          <Search size={14} color={MUTED} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={raw}
            onChange={(e) => setSearchRaw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void resolve(); }}
            placeholder={activeModelGoverned ? `Search or resolve — e.g. "${DEMO}"` : 'Filter definitions…'}
            style={{
              width: '100%', ...SANS, fontSize: 13, color: INK, background: 'rgba(0,0,0,0.2)',
              border: `1px solid ${BORDER}`, borderRadius: 4, padding: '8px 32px 8px 32px', outline: 'none',
            }}
          />
          {raw && (
            <button onClick={() => { setSearchRaw(''); clearSearch(); }} aria-label="Clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer' }}>
              <X size={13} />
            </button>
          )}
        </div>
        {activeModelGoverned ? (
          <button
            onClick={() => void resolve()}
            disabled={!raw.trim() || resolving}
            style={{ ...MONO, fontSize: 11, fontWeight: 600, padding: '8px 14px', borderRadius: 4, cursor: raw.trim() ? 'pointer' : 'not-allowed', border: `1px solid ${GOLD}`, background: raw.trim() && !resolving ? GOLD : 'transparent', color: raw.trim() && !resolving ? '#1A1206' : MUTED }}
          >
            {resolving ? 'Resolving…' : 'Resolve'}
          </button>
        ) : (
          <span style={{ ...MONO, fontSize: 10, color: MUTED, maxWidth: 260, lineHeight: 1.4 }}>
            Term resolution unlocks on a governed model.
          </span>
        )}
        {!raw && activeModelGoverned && (
          <button onClick={() => setSearchRaw(DEMO)} style={{ ...MONO, fontSize: 10, color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer' }}>try demo</button>
        )}
      </div>

      {resolveError && (
        <div style={{ ...MONO, fontSize: 10, color: 'var(--mc-res-unrecognized)', marginTop: 8 }}>Resolution error: {resolveError}</div>
      )}

      {resolvedTerms.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.08em' }}>RESOLVED</span>
          {resolvedTerms.map((t, i) => (
            <TermChip key={`${t.term}-${i}`} term={t} onApply={applyDef} onChoose={chooseAmbiguous} onDefine={onDefine} />
          ))}
        </div>
      )}
    </div>
  );
}

function TermChip({ term, onApply, onChoose, onDefine }: {
  term: IntentDisambiguation;
  onApply: (defId: string) => void;
  onChoose: (term: string, id: string) => void;
  onDefine: (term: string) => void;
}) {
  if (term.resolution === 'matched') {
    const c = term.candidates[0];
    return (
      <Chip color="var(--mc-res-matched)" icon={<CheckCircle2 size={11} />} onClick={() => c && onApply(c.id)} title="Filter to this definition">
        {c?.label ?? term.term}
      </Chip>
    );
  }
  if (term.resolution === 'not_governed') {
    const c = term.candidates[0];
    return (
      <Chip color="var(--mc-res-notgov)" icon={<AlertCircle size={11} />} onClick={() => c && onApply(c.id)} title="Recognized, but only a candidate — click to filter">
        {c?.label ?? term.term} · candidate
      </Chip>
    );
  }
  if (term.resolution === 'ambiguous') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--mc-res-ambiguous)' }}>
          <HelpCircle size={11} style={{ verticalAlign: '-2px', marginRight: 3 }} />
          &ldquo;{term.term}&rdquo; is ambiguous — did you mean:
        </span>
        {term.candidates.map((c) => (
          <Chip key={c.id} color="var(--mc-res-ambiguous)" outline onClick={() => { onChoose(term.term, c.id); onApply(c.id); }}>
            {c.label}
          </Chip>
        ))}
      </span>
    );
  }
  // unrecognized — refuse rather than guess
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ ...SANS, fontSize: 11, color: 'var(--mc-res-unrecognized)' }}>
        &ldquo;{term.term}&rdquo; isn&apos;t defined in this model. I won&apos;t fabricate a result.
      </span>
      <Chip color="var(--mc-res-unrecognized)" outline icon={<PlusCircle size={11} />} onClick={() => onDefine(term.term)}>Define it →</Chip>
      {term.cappedByTopK && (
        <span style={{ ...MONO, fontSize: 9, color: MUTED }}>(search may be truncated — a match could exist past the cap)</span>
      )}
    </span>
  );
}

function Chip({ color, icon, children, onClick, outline, title }: {
  color: string; icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; outline?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, ...MONO, fontSize: 10, fontWeight: 600,
        padding: '3px 9px', borderRadius: 12, cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${outline ? color : `color-mix(in srgb, ${color} 45%, transparent)`}`,
        background: outline ? 'transparent' : `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      {icon}{children}
    </button>
  );
}
