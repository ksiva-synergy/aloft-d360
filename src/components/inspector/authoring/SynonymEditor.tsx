'use client';

import React, { useState, useCallback } from 'react';
import { Plus, X, Tag } from 'lucide-react';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const GOLD = '#FDB515';
const NAVY = '#003262';
const MUTED = '#8892A4';
const BLUE = '#93C5FD';

export interface SynonymEditorProps {
  modelId: string;
  tableKind: 'entity' | 'dimension' | 'measure';
  defId: string;
  /** Current synonyms of the definition. */
  synonyms: string[];
  /** Called with the new full synonyms array after a successful save. */
  onSaved?: (next: string[]) => void;
  /** Compact rendering (inline in a governance row) vs. full (authoring panel). */
  compact?: boolean;
}

/**
 * "This metric is also called…" — add/remove aliases on a definition (Phase 3.5D).
 *
 * Synonyms feed NL resolution (buildSemanticPromptSection now surfaces them to
 * the LLM) and disambiguation ranking. Persisting reuses the 3.5B gated PATCH
 * (`/definitions/[definitionId]`) with `fields: { synonyms: <merged array> }`:
 *   - editing your OWN draft is free;
 *   - editing a candidate/governed def is reputation-gated (403 surfaced below);
 *   - synonyms are NOT in SNAPSHOT_RELEVANT_FIELDS, so adding one to a governed
 *     def is a COSMETIC edit — it never demotes (no number changed).
 *
 * The gated PATCH replaces the whole array, so we always send the merged set
 * (existing ± the change) computed client-side.
 */
export function SynonymEditor({
  modelId,
  tableKind,
  defId,
  synonyms,
  onSaved,
  compact = false,
}: SynonymEditorProps) {
  const [list, setList] = useState<string[]>(synonyms ?? []);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(
    async (next: string[]) => {
      setSaving(true);
      setError(null);
      const prev = list;
      setList(next); // optimistic
      try {
        const res = await fetch(`/api/inspector/semantic/${modelId}/definitions/${defId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableKind, fields: { synonyms: next } }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? 'Save failed');
        }
        onSaved?.(next);
      } catch (e) {
        setList(prev); // roll back optimistic update
        setError(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [list, modelId, defId, tableKind, onSaved],
  );

  const addSynonym = useCallback(() => {
    const v = input.trim();
    if (!v) return;
    // Case-insensitive dedup against the current list.
    if (list.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setInput('');
      return;
    }
    setInput('');
    void persist([...list, v]);
  }, [input, list, persist]);

  const removeSynonym = useCallback(
    (syn: string) => {
      void persist(list.filter((s) => s !== syn));
    },
    [list, persist],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: compact ? 4 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Tag size={compact ? 10 : 11} color={MUTED} />
        <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.08em', color: MUTED, textTransform: 'uppercase' }}>
          Also called
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {list.map((syn) => (
          <span
            key={syn}
            style={{
              ...MONO,
              fontSize: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 6px 3px 8px',
              borderRadius: 12,
              border: `1px solid rgba(147,197,253,0.4)`,
              background: 'rgba(147,197,253,0.08)',
              color: BLUE,
            }}
          >
            {syn}
            <button
              onClick={() => removeSynonym(syn)}
              disabled={saving}
              title="Remove alias"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                color: BLUE,
                cursor: saving ? 'default' : 'pointer',
                padding: 0,
                opacity: 0.7,
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {list.length === 0 && (
          <span style={{ ...MONO, fontSize: 10, color: MUTED, fontStyle: 'italic' }}>no aliases yet</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addSynonym(); }
          }}
          placeholder="e.g. ARR, Annual Recurring Revenue"
          disabled={saving}
          style={{
            ...MONO,
            fontSize: 10,
            flex: 1,
            minWidth: 0,
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid rgba(74,96,128,0.35)',
            borderRadius: 4,
            color: 'var(--wb-ink, #E6ECF5)',
            padding: '4px 8px',
            outline: 'none',
          }}
        />
        <button
          onClick={addSynonym}
          disabled={saving || !input.trim()}
          title="Add alias"
          style={{
            ...MONO,
            fontSize: 9,
            letterSpacing: '0.04em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            background: input.trim() && !saving ? GOLD : 'transparent',
            color: input.trim() && !saving ? NAVY : MUTED,
            border: `1px solid ${input.trim() && !saving ? GOLD : 'rgba(136,146,164,0.35)'}`,
            borderRadius: 4,
            padding: '4px 9px',
            cursor: input.trim() && !saving ? 'pointer' : 'default',
          }}
        >
          <Plus size={10} />
          {saving ? '…' : 'ADD'}
        </button>
      </div>
      {error && (
        <span style={{ ...MONO, fontSize: 9, color: '#f43f5e', lineHeight: 1.4 }}>{error}</span>
      )}
    </div>
  );
}
