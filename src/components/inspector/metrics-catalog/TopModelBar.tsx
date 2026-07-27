'use client';

import React from 'react';
import { Ruler, Scale, Circle, ChevronDown, Plus } from 'lucide-react';
import { useCatalogStore } from './catalog-store';
import { MONO, SANS, MUTED, INK, GOLD, BORDER } from './mc-ui';

/**
 * Top model bar: brand, active-model picker (switches scope → refetch), candidate
 * / governed counts, and the Govern ⇄ Explore lens toggle. `+ New Model` is
 * disabled with a tooltip (blocked on DEC-1 / the connection_id migration).
 */
export function TopModelBar() {
  const session = useCatalogStore((s) => s.session);
  const activeModelId = useCatalogStore((s) => s.activeModelId);
  const setActiveModel = useCatalogStore((s) => s.setActiveModel);
  const lens = useCatalogStore((s) => s.lens);
  const setLens = useCatalogStore((s) => s.setLens);
  const rows = useCatalogStore((s) => s.rows);

  const [open, setOpen] = React.useState(false);

  const models = session?.models ?? [];
  const active = models.find((m) => m.id === activeModelId) ?? null;

  // Counts scoped to the active model (from loaded rows).
  const governed = rows.filter((r) => r.status === 'governed').length;
  const candidate = rows.filter((r) => r.status === 'candidate').length;

  const statusOrder = (s: string) => (s === 'governed' ? 0 : s === 'candidate' ? 1 : 2);
  const sorted = [...models].sort(
    (a, b) => statusOrder(a.status) - statusOrder(b.status) || a.name.localeCompare(b.name),
  );

  const pick = (id: string) => {
    const governedModel = models.find((m) => m.id === id)?.status === 'governed';
    setActiveModel(id, governedModel);
    setOpen(false);
  };

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 20px',
        borderBottom: `1px solid ${BORDER}`,
        background: 'var(--header-bg, transparent)',
      }}
    >
      {/* Brand + model picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Ruler size={16} color={GOLD} />
          <span style={{ ...MONO, fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>ALOFT v0.4</span>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={!models.length}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(0,0,0,0.18)',
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              padding: '5px 10px',
              cursor: models.length ? 'pointer' : 'default',
              maxWidth: 360,
            }}
          >
            <span style={{ ...SANS, fontSize: 13, fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {active?.name ?? 'No model'}
            </span>
            {active && (
              <span style={{ ...MONO, fontSize: 9, color: MUTED, textTransform: 'uppercase' }}>{active.status}</span>
            )}
            <ChevronDown size={13} color={MUTED} />
          </button>

          {open && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  minWidth: 320,
                  maxHeight: 360,
                  overflowY: 'auto',
                  background: 'var(--card, #0d1520)',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  zIndex: 41,
                  padding: 4,
                }}
              >
                <div style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.08em', padding: '6px 8px 4px' }}>
                  SEMANTIC MODELS
                </div>
                {sorted.map((m) => (
                  <button
                    key={m.id}
                    role="option"
                    aria-selected={m.id === activeModelId}
                    onClick={() => pick(m.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      width: '100%',
                      textAlign: 'left',
                      background: m.id === activeModelId ? 'rgba(253,181,21,0.08)' : 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      padding: '7px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ ...SANS, fontSize: 12, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name}
                    </span>
                    <span style={{ ...MONO, fontSize: 9, color: MUTED, textTransform: 'uppercase' }}>{m.status}</span>
                  </button>
                ))}
                <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4, paddingTop: 4 }}>
                  <button
                    disabled
                    title="Creating a new model needs per-model warehouse binding (DEC-1) — not enabled yet."
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 4,
                      padding: '7px 8px',
                      cursor: 'not-allowed',
                      opacity: 0.45,
                    }}
                  >
                    <Plus size={13} color={MUTED} />
                    <span style={{ ...SANS, fontSize: 12, color: MUTED }}>New Model</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {active && (
          <div style={{ ...MONO, fontSize: 10, color: MUTED, display: 'flex', gap: 12 }}>
            <span><span style={{ color: 'var(--mc-status-governed)' }}>{governed}</span> governed</span>
            <span><span style={{ color: 'var(--mc-status-candidate)' }}>{candidate}</span> candidate</span>
          </div>
        )}
      </div>

      {/* Lens toggle */}
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.18)', border: `1px solid ${BORDER}`, borderRadius: 6, padding: 2 }}>
        <LensButton active={lens === 'govern'} onClick={() => setLens('govern')} icon={<Scale size={13} />} label="Govern" />
        <LensButton active={lens === 'explore'} onClick={() => setLens('explore')} icon={<Circle size={13} />} label="Explore" />
      </div>
    </div>
  );
}

function LensButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: 4,
        border: 'none',
        cursor: 'pointer',
        background: active ? GOLD : 'transparent',
        color: active ? '#1A1206' : MUTED,
        ...MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
