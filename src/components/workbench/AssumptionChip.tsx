'use client';

import React, { useState } from 'react';
import type { AssumptionLedgerEntry } from '@/lib/construction/assumptionHelpers';
import { type } from '@/lib/typography/tokens';

// ─── Design tokens ────────────────────────────────────────────────────────────
const GOLD    = 'var(--brand-a)';
const NAVY2   = 'color-mix(in srgb, var(--brand-a) 45%, transparent)';
const SURFACE2 = 'var(--surface-2)';
const TXT     = 'var(--ink-1)';
const TXT2    = 'var(--ink-2)';
const TXT3    = 'var(--ink-3)';
const LINE2   = 'var(--line-2)';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

// ─── Field label translation map ─────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  'memory.buildContext.dataAccessScope': 'data access scope',
  'memory.buildContext.userRole': 'user role',
  'tools.output.schemaRef': 'output format',
  'tools.datasources': 'data source',
  'tools.actions': 'actions',
  'prompt.useCaseTag': 'use case',
  'prompt.persona': 'persona',
  'prompt.instructions': 'instructions',
  'class.id': 'agent class',
  'name': 'agent name',
};

export function fieldToLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  // Fallback: take last dot-segment, split camelCase, lowercase
  const last = field.split('.').pop() ?? field;
  return last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

// ─── Value display helper ─────────────────────────────────────────────────────

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length > 40 ? value.slice(0, 40) + '…' : value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return `${value.length} item${value.length !== 1 ? 's' : ''}`;
  return String(value);
}

// ─── AssumptionChip ───────────────────────────────────────────────────────────

export interface AssumptionChipProps {
  entry: AssumptionLedgerEntry;
  onConfirm: () => void;
  onEdit: (newValue: string) => void;
}

export function AssumptionChip({ entry, onConfirm, onEdit }: AssumptionChipProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(entry.value ?? ''));

  const isConfirmed = entry.status === 'confirmed' || entry.status === 'corrected';
  const label = fieldToLabel(entry.field);
  const valStr = displayValue(entry.value);

  const handleEditSubmit = () => {
    setEditing(false);
    if (editValue.trim() !== String(entry.value ?? '')) {
      onEdit(editValue.trim());
    }
  };

  return (
    <div style={{
      background: isConfirmed
        ? `linear-gradient(90deg, rgba(0,50,98,.4), ${SURFACE2})`
        : SURFACE2,
      border: `1px solid ${isConfirmed ? NAVY2 : LINE2}`,
      borderRadius: 6,
      padding: '6px 6px 6px 11px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      transition: 'border-color 0.2s',
    }}>
      {/* Label */}
      <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: TXT2, flex: 1, lineHeight: 1.4 }}>
        {isConfirmed ? (
          <>assumed <span style={{ color: TXT, fontWeight: 500 }}>{valStr}</span> for {label}</>
        ) : editing ? null : (
          <>assumed <span style={{ color: TXT, fontWeight: 500 }}>{valStr}</span> for {label}</>
        )}
        {editing && (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditSubmit();
              if (e.key === 'Escape') { setEditing(false); setEditValue(String(entry.value ?? '')); }
            }}
            style={{
              ...mono, fontSize: 'var(--type-ui-regular-size)', color: TXT,
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${GOLD}`,
              outline: 'none',
              width: '100%',
              padding: '0 2px',
            }}
          />
        )}
      </span>

      {/* Confirmed badge — replaces ::after pseudo from spec */}
      {isConfirmed && (
        <span style={{ ...type.label, flexShrink: 0, paddingRight: 6 }}>
          confirmed
        </span>
      )}

      {/* Actions (hidden when confirmed) */}
      {!isConfirmed && !editing && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={onConfirm}
            title="Confirm assumption"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              ...mono, fontSize: 'var(--type-ui-regular-size)', color: GOLD,
              padding: '0 4px',
              borderRadius: 3,
              lineHeight: 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--brand-a) 18%, transparent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            ✓
          </button>
          <button
            onClick={() => setEditing(true)}
            title="Edit value"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              ...mono, fontSize: 'var(--type-ui-regular-size)', color: TXT3,
              padding: '0 4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = TXT; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = TXT3; }}
          >
            edit
          </button>
        </div>
      )}
    </div>
  );
}
