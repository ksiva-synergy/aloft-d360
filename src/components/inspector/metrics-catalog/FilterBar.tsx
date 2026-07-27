'use client';

import React from 'react';
import { ChevronDown, X, AlertTriangle } from 'lucide-react';
import {
  useCatalogStore,
  selectFacetCounts,
  type LayerFacet,
} from './catalog-store';
import type { DefKind, GovStatus } from './catalog-types';
import {
  MONO,
  SANS,
  MUTED,
  INK,
  INK_DIM,
  BORDER,
  GOLD,
  kindLabel,
  kindColorVar,
  statusLabel,
  statusColorVar,
  tint,
} from './mc-ui';
import { selectCoverage } from './catalog-store';

// ── Types ────────────────────────────────────────────────────────────────────

interface FacetOption {
  value: string;
  label: string;
  count: number;
  /** Optional color dot var */
  color?: string;
  /** Gap warning icon (theme filter) */
  gap?: boolean;
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

/**
 * Horizontal filter bar replacing the vertical FacetRail.
 * Each facet group is a button that opens a searchable popover checklist.
 * Active selections appear as dismissible chip pills inline.
 */
export function FilterBar() {
  const rows = useCatalogStore((s) => s.rows);
  const facets = useCatalogStore((s) => s.facets);
  const toggleFacet = useCatalogStore((s) => s.toggleFacet);
  const clearFacets = useCatalogStore((s) => s.clearFacets);
  const session = useCatalogStore((s) => s.session);
  const gapsOnly = useCatalogStore((s) => s.gapsOnly);
  const setGapsOnly = useCatalogStore((s) => s.setGapsOnly);

  const counts = React.useMemo(
    () => selectFacetCounts(rows, session?.currentUserId ?? null),
    [rows, session],
  );

  const coverageBuckets = React.useMemo(() => selectCoverage(rows), [rows]);
  const gapSet = React.useMemo(
    () => new Set(coverageBuckets.filter((b) => b.gap).map((b) => b.theme)),
    [coverageBuckets],
  );

  const statusOptions: FacetOption[] = counts.status.map((c) => ({
    value: c.value,
    label: statusLabel(c.value as GovStatus),
    count: c.count,
    color: statusColorVar(c.value as GovStatus),
  }));

  const typeOptions: FacetOption[] = counts.type.map((c) => ({
    value: c.value,
    label: kindLabel(c.value as DefKind),
    count: c.count,
    color: kindColorVar(c.value as DefKind),
  }));

  const themeOptions: FacetOption[] = counts.theme.map((c) => ({
    value: c.value,
    label: c.value,
    count: c.count,
    gap: gapSet.has(c.value),
  }));

  const sourceOptions: FacetOption[] = counts.source.map((c) => ({
    value: c.value,
    label: c.value.split('.').slice(-1)[0] || c.value,
    count: c.count,
  }));

  const anyActive =
    facets.status.length +
      facets.type.length +
      facets.theme.length +
      facets.source.length +
      facets.layer.length >
      0 || gapsOnly;

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${BORDER}`,
        padding: '8px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Filter trigger buttons row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...MONO, fontSize: 9, color: MUTED, letterSpacing: '0.08em', marginRight: 2 }}>
          FILTER
        </span>

        <FacetDropdown
          label="Status"
          options={statusOptions}
          selected={facets.status}
          onToggle={(v) => toggleFacet('status', v as GovStatus)}
        />
        <FacetDropdown
          label="Type"
          options={typeOptions}
          selected={facets.type}
          onToggle={(v) => toggleFacet('type', v as DefKind)}
        />
        <FacetDropdown
          label="Theme"
          options={themeOptions}
          selected={facets.theme}
          onToggle={(v) => toggleFacet('theme', v)}
          searchable
        />
        {sourceOptions.length > 1 && (
          <FacetDropdown
            label="Source"
            options={sourceOptions}
            selected={facets.source}
            onToggle={(v) => toggleFacet('source', v)}
            searchable
            mono
          />
        )}
        {(counts.layer.my_drafts > 0 || counts.layer.authored > 0) && (
          <FacetDropdown
            label="My layers"
            options={[
              { value: 'my_drafts', label: 'My Drafts', count: counts.layer.my_drafts },
              { value: 'authored', label: "What I've Taught", count: counts.layer.authored },
            ]}
            selected={facets.layer}
            onToggle={(v) => toggleFacet('layer', v as LayerFacet)}
          />
        )}

        {/* Gaps toggle */}
        <button
          onClick={() => setGapsOnly(!gapsOnly)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            ...MONO,
            fontSize: 10,
            padding: '5px 9px',
            borderRadius: 4,
            cursor: 'pointer',
            border: `1px solid ${gapsOnly ? GOLD : BORDER}`,
            background: gapsOnly ? 'rgba(253,181,21,0.12)' : 'transparent',
            color: gapsOnly ? GOLD : MUTED,
          }}
        >
          <AlertTriangle size={11} />
          Gaps only
          {gapSet.size > 0 && (
            <span
              style={{
                ...MONO,
                fontSize: 9,
                background: gapsOnly ? GOLD : 'rgba(253,181,21,0.15)',
                color: gapsOnly ? '#1A1206' : GOLD,
                borderRadius: 3,
                padding: '1px 4px',
                marginLeft: 2,
              }}
            >
              {gapSet.size}
            </span>
          )}
        </button>

        {anyActive && (
          <button
            onClick={clearFacets}
            style={{
              ...MONO,
              fontSize: 9,
              color: MUTED,
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              padding: '5px 9px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 4,
            }}
          >
            <X size={10} /> Clear all
          </button>
        )}
      </div>

      {/* Active filter chip pills */}
      {anyActive && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 2 }}>
          {facets.status.map((v) => (
            <ActiveChip
              key={v}
              label={statusLabel(v)}
              color={statusColorVar(v)}
              onRemove={() => toggleFacet('status', v)}
            />
          ))}
          {facets.type.map((v) => (
            <ActiveChip
              key={v}
              label={kindLabel(v)}
              color={kindColorVar(v)}
              onRemove={() => toggleFacet('type', v)}
            />
          ))}
          {facets.theme.map((v) => (
            <ActiveChip
              key={v}
              label={v}
              color={GOLD}
              onRemove={() => toggleFacet('theme', v)}
            />
          ))}
          {facets.source.map((v) => (
            <ActiveChip
              key={v}
              label={v.split('.').slice(-1)[0] || v}
              title={v}
              color="var(--mc-kind-entity)"
              onRemove={() => toggleFacet('source', v)}
              mono
            />
          ))}
          {facets.layer.map((v) => (
            <ActiveChip
              key={v}
              label={v === 'my_drafts' ? 'My Drafts' : "What I've Taught"}
              color={GOLD}
              onRemove={() => toggleFacet('layer', v as LayerFacet)}
            />
          ))}
          {gapsOnly && (
            <ActiveChip label="Gaps only" color={GOLD} onRemove={() => setGapsOnly(false)} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Active chip ───────────────────────────────────────────────────────────────

function ActiveChip({
  label,
  color,
  onRemove,
  mono,
  title,
}: {
  label: string;
  color: string;
  onRemove: () => void;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        ...(mono ? MONO : SANS),
        fontSize: 10,
        color,
        background: tint(color, 12),
        border: `1px solid ${tint(color, 30)}`,
        borderRadius: 4,
        padding: '2px 6px 2px 8px',
        whiteSpace: 'nowrap',
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'transparent',
          border: 'none',
          color,
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={9} />
      </button>
    </span>
  );
}

// ── Facet dropdown ────────────────────────────────────────────────────────────

function FacetDropdown({
  label,
  options,
  selected,
  onToggle,
  searchable,
  mono,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
  mono?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const activeCount = options.filter((o) => selected.includes(o.value)).length;

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Focus search input when opening
  React.useEffect(() => {
    if (open && searchable) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, searchable]);

  const isActive = activeCount > 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (open) setQuery('');
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          ...MONO,
          fontSize: 10,
          padding: '5px 9px',
          borderRadius: 4,
          cursor: 'pointer',
          border: `1px solid ${isActive ? GOLD : BORDER}`,
          background: isActive ? 'rgba(253,181,21,0.1)' : 'transparent',
          color: isActive ? GOLD : INK_DIM,
        }}
      >
        {label}
        {isActive && (
          <span
            style={{
              ...MONO,
              fontSize: 9,
              background: GOLD,
              color: '#1A1206',
              borderRadius: 3,
              padding: '1px 5px',
              fontWeight: 600,
            }}
          >
            {activeCount}
          </span>
        )}
        <ChevronDown
          size={11}
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            marginTop: 4,
            minWidth: 220,
            maxWidth: 320,
            background: 'var(--card, #0d1520)',
            border: `1px solid ${BORDER}`,
            borderRadius: 5,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            overflow: 'hidden',
          }}
        >
          {searchable && (
            <div
              style={{
                padding: '8px 10px',
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                style={{
                  width: '100%',
                  ...MONO,
                  fontSize: 11,
                  color: INK,
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 3,
                  padding: '5px 8px',
                  outline: 'none',
                }}
              />
            </div>
          )}

          <div style={{ maxHeight: 260, overflowY: 'auto' }} className="agent-labs-scrollbar">
            {filtered.length === 0 && (
              <div style={{ ...MONO, fontSize: 10, color: MUTED, padding: '10px 12px' }}>
                No matches
              </div>
            )}
            {filtered.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => onToggle(o.value)}
                  title={o.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 12px',
                    background: checked ? 'rgba(253,181,21,0.07)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!checked) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    if (!checked) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Checkbox */}
                  <span
                    aria-hidden
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      flexShrink: 0,
                      border: `1.5px solid ${checked ? GOLD : MUTED}`,
                      background: checked ? GOLD : 'transparent',
                    }}
                  />
                  {/* Color dot */}
                  {o.color && (
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        background: o.color,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {/* Gap icon */}
                  {o.gap && !o.color && (
                    <AlertTriangle size={10} color={GOLD} style={{ flexShrink: 0 }} />
                  )}
                  {/* Label */}
                  <span
                    style={{
                      ...(mono ? MONO : {}),
                      fontSize: mono ? 10 : 11,
                      color: checked ? GOLD : INK,
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {o.label}
                  </span>
                  {/* Count */}
                  <span style={{ ...MONO, fontSize: 9, color: MUTED, flexShrink: 0 }}>
                    {o.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Quick-clear for this group */}
          {activeCount > 0 && (
            <div
              style={{
                padding: '6px 12px',
                borderTop: `1px solid ${BORDER}`,
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => {
                  for (const v of selected) onToggle(v);
                  setOpen(false);
                  setQuery('');
                }}
                style={{
                  ...MONO,
                  fontSize: 9,
                  color: MUTED,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
