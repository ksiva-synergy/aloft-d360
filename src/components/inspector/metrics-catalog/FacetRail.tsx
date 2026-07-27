'use client';

import React from 'react';
import { useCatalogStore, selectFacetCounts, type LayerFacet } from './catalog-store';
import type { DefKind, GovStatus } from './catalog-types';
import { MONO, MUTED, INK, INK_DIM, BORDER, GOLD, kindLabel, statusLabel, kindColorVar, statusColorVar } from './mc-ui';

/**
 * Faceted filter rail: Status · Type · Theme · Source · personal layers, each
 * option with a live count. Counts are computed over the current model's rows
 * (see selectFacetCounts) so they reflect what's available, not what's selected.
 */
export function FacetRail() {
  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const toggleFacet = useCatalogStore((s) => s.toggleFacet);
  const clearFacets = useCatalogStore((s) => s.clearFacets);
  const session = useCatalogStore((s) => s.session);

  const counts = React.useMemo(
    () => selectFacetCounts(rows, session?.currentUserId ?? null),
    [rows, session],
  );

  const anyActive =
    facets.status.length + facets.type.length + facets.theme.length + facets.source.length + facets.layer.length > 0;

  return (
    <div
      style={{
        width: 232,
        flexShrink: 0,
        borderRight: `1px solid ${BORDER}`,
        overflowY: 'auto',
        padding: '12px 12px 32px',
      }}
      className="agent-labs-scrollbar"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ ...MONO, fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>FILTERS</span>
        {anyActive && (
          <button
            onClick={clearFacets}
            style={{ ...MONO, fontSize: 9, color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            Clear all
          </button>
        )}
      </div>

      <Group title="Status">
        {counts.status.map((c) => (
          <Row
            key={c.value}
            label={statusLabel(c.value as GovStatus)}
            count={c.count}
            dot={statusColorVar(c.value as GovStatus)}
            checked={facets.status.includes(c.value as GovStatus)}
            onToggle={() => toggleFacet('status', c.value as GovStatus)}
          />
        ))}
      </Group>

      <Group title="Type">
        {counts.type.map((c) => (
          <Row
            key={c.value}
            label={kindLabel(c.value as DefKind)}
            count={c.count}
            dot={kindColorVar(c.value as DefKind)}
            checked={facets.type.includes(c.value as DefKind)}
            onToggle={() => toggleFacet('type', c.value as DefKind)}
          />
        ))}
      </Group>

      <Group title="Theme">
        {counts.theme.map((c) => (
          <Row
            key={c.value}
            label={c.value}
            count={c.count}
            checked={facets.theme.includes(c.value)}
            onToggle={() => toggleFacet('theme', c.value)}
          />
        ))}
      </Group>

      {counts.source.length > 1 && (
        <Group title="Source table">
          {counts.source.slice(0, 12).map((c) => (
            <Row
              key={c.value}
              label={c.value.split('.').slice(-1)[0] || c.value}
              title={c.value}
              mono
              count={c.count}
              checked={facets.source.includes(c.value)}
              onToggle={() => toggleFacet('source', c.value)}
            />
          ))}
        </Group>
      )}

      {(counts.layer.my_drafts > 0 || counts.layer.authored > 0) && (
        <Group title="My layers">
          <Row
            label="My Drafts"
            count={counts.layer.my_drafts}
            checked={facets.layer.includes('my_drafts')}
            onToggle={() => toggleFacet('layer', 'my_drafts' as LayerFacet)}
          />
          <Row
            label="What I've Taught"
            count={counts.layer.authored}
            checked={facets.layer.includes('authored')}
            onToggle={() => toggleFacet('layer', 'authored' as LayerFacet)}
          />
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...MONO, fontSize: 9, color: INK_DIM, letterSpacing: '0.06em', marginBottom: 5 }}>{title.toUpperCase()}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function Row({
  label, count, checked, onToggle, dot, mono, title,
}: {
  label: string; count: number; checked: boolean; onToggle: () => void; dot?: string; mono?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
        background: checked ? 'rgba(253,181,21,0.08)' : 'transparent', border: 'none',
        borderRadius: 3, padding: '4px 6px', cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12, height: 12, borderRadius: 3, flexShrink: 0,
          border: `1.5px solid ${checked ? GOLD : 'var(--wb-muted, #8892A4)'}`,
          background: checked ? GOLD : 'transparent',
        }}
      />
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: 2, background: dot, flexShrink: 0 }} />}
      <span
        style={{
          ...(mono ? MONO : {}), fontSize: mono ? 10 : 11, color: checked ? GOLD : INK,
          flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      <span style={{ ...MONO, fontSize: 9, color: MUTED, flexShrink: 0 }}>{count}</span>
    </button>
  );
}
