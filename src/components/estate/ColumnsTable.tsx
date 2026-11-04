'use client';

// ColumnsTable — every column of the table with its profile and meaning.
//
// Card header: title + counts, search ("/" focuses it), role filter, PII filter.
// Rows: column (name + type + PII flag), role, nulls (bar), distinct, range,
// top values, description, confidence. Clicking a row opens a detail panel
// with the full description, every top value, range, and the source comment.
// External focus (from the semantic card) searches, scrolls and pulses a row.

import { Select } from '@/components/form/Select';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type } from '@/lib/typography/tokens';
import { Card, Tag, EmptyNote, TONE_COLOR, type Tone } from './object-ui';

export interface ColumnItem {
  id: string;
  name: string;
  data_type: string | null;
  ordinal: number | null;
  native_comment: string | null;
  profile: any;
  semantic: any;
}

interface ColumnsTableProps {
  columns: ColumnItem[];
  focusColumn?: string | null;
  onFocusClear?: () => void;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function pct(rate: any): number | null {
  if (rate === null || rate === undefined) return null;
  const v = Number(rate);
  return Number.isNaN(v) ? null : v;
}

function formatDistinct(distinct: any): string {
  if (distinct === null || distinct === undefined) return '—';
  const val = Number(distinct);
  if (Number.isNaN(val)) return '—';
  return new Intl.NumberFormat(undefined, { notation: val >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(val);
}

/** Short display for a profile min/max bound (ISO timestamps → date part). */
function formatBound(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  const date = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(s);
  return date ? date[1] : s;
}

function topK(topKRaw: any): { value: string; count: number | null }[] {
  if (!Array.isArray(topKRaw) || topKRaw.length === 0) return [];
  return topKRaw.map((item: any) => {
    if (item && typeof item === 'object') {
      return {
        value: item.value !== undefined ? String(item.value) : JSON.stringify(item),
        count: typeof item.count === 'number' ? item.count : null,
      };
    }
    return { value: String(item), count: null };
  });
}

// Role values are shown as stored (semantic.role) — technical names, not relabelled.
const ROLE: Record<string, { tone: Tone; label: string }> = {
  key:       { tone: 'brand',   label: 'key' },
  fk_ref:    { tone: 'blue',    label: 'fk_ref' },
  dimension: { tone: 'violet',  label: 'dimension' },
  measure:   { tone: 'green',   label: 'measure' },
  timestamp: { tone: 'amber',   label: 'timestamp' },
  audit:     { tone: 'neutral', label: 'audit' },
  text_blob: { tone: 'neutral', label: 'text_blob' },
  flag:      { tone: 'neutral', label: 'flag' },
  other:     { tone: 'neutral', label: 'other' },
};

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ backgroundColor: 'color-mix(in srgb, var(--brand-a) 22%, transparent)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function NullBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: 'var(--estate-text-muted)' }}>—</span>;
  const p = Math.max(0, Math.min(1, rate));
  const color = p >= 0.5 ? TONE_COLOR.red : p >= 0.1 ? TONE_COLOR.amber : TONE_COLOR.green;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }} title={`null_rate ${(p * 100).toFixed(2)}%`}>
      <div style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--estate-active-bg)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(p * 100, p > 0 ? 4 : 0)}%`, height: '100%', background: color }} />
      </div>
      <span style={{ ...type['code-inline'], color: 'var(--estate-ink)', minWidth: 40, textAlign: 'right' }}>
        {p === 0 ? '0%' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`}
      </span>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

interface ColumnRowProps {
  col: ColumnItem;
  searchQuery: string;
  highlighted: boolean;
  expanded: boolean;
  onToggle: () => void;
  rowRef?: React.Ref<HTMLTableRowElement>;
}

const CELL = 'px-4 py-3 align-middle';
const COLS = 8;

function ColumnRow({ col, searchQuery, highlighted, expanded, onToggle, rowRef }: ColumnRowProps) {
  const profile = col.profile || {};
  const semantic = col.semantic || {};

  const isPii = semantic.pii_flag === true;
  const role = typeof semantic.role === 'string' ? semantic.role : null;
  const roleDef = role ? (ROLE[role] ?? { tone: 'neutral' as Tone, label: role }) : null;
  const description: string = semantic.description || col.native_comment || '';
  const descriptionIsNative = !semantic.description && !!col.native_comment;
  const confidence = typeof semantic.confidence === 'number' ? semantic.confidence : null;
  const values = topK(profile.top_k);
  const lo = formatBound(profile.min);
  const hi = formatBound(profile.max);

  return (
    <>
      <tr
        ref={rowRef}
        onClick={onToggle}
        aria-expanded={expanded}
        className="cursor-pointer transition-colors hover:bg-[var(--estate-hover)]"
        style={{
          borderTop: '1px solid var(--estate-border)',
          background: highlighted
            ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)'
            : expanded ? 'var(--estate-hover)' : undefined,
          boxShadow: highlighted ? 'inset 3px 0 0 var(--brand-a)' : undefined,
          transition: 'background-color 0.4s ease, box-shadow 0.4s ease',
        }}
      >
        {/* Column */}
        <td className={CELL}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                color: 'var(--estate-text-muted)',
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s ease',
                display: 'inline-flex',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ ...type['code-inline'], color: 'var(--estate-ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={col.name}>
                <Highlight text={col.name} query={searchQuery} />
              </span>
              <span style={{ ...type.caption, color: 'var(--estate-text-muted)', fontFamily: 'var(--font-mono)' }}>
                {col.data_type || 'unknown'}
              </span>
            </div>
            {isPii && <Tag tone="red" title="Personal data">PII</Tag>}
          </div>
        </td>
        {/* Role */}
        <td className={CELL}>
          {roleDef ? <Tag tone={roleDef.tone}>{roleDef.label}</Tag> : <span style={{ color: 'var(--estate-text-muted)' }}>—</span>}
        </td>
        {/* Nulls */}
        <td className={CELL}><NullBar rate={pct(profile.null_rate)} /></td>
        {/* Distinct */}
        <td className={CELL} style={{ ...type['code-inline'], color: 'var(--estate-ink)', textAlign: 'right' }}>
          {formatDistinct(profile.distinct_est)}
        </td>
        {/* Range */}
        <td className={CELL} style={{ ...type['code-inline'], color: 'var(--estate-text-secondary)' }}>
          {!lo && !hi ? (
            <span style={{ color: 'var(--estate-text-muted)' }}>—</span>
          ) : isPii ? (
            <span title="Hidden — pii_flag" style={{ color: 'var(--estate-text-muted)' }}>hidden (PII)</span>
          ) : (
            <span className="block truncate" title={`min: ${lo ?? '—'}\nmax: ${hi ?? '—'}`}>
              {lo === hi ? lo : `${lo ?? '…'} → ${hi ?? '…'}`}
            </span>
          )}
        </td>
        {/* Top values */}
        <td className={CELL}>
          {isPii ? (
            <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>hidden</span>
          ) : values.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {values.slice(0, 2).map((v, i) => (
                <span key={i} className="truncate" style={{ maxWidth: 110 }} title={v.value}>
                  <Tag tone="neutral" mono>{v.value}</Tag>
                </span>
              ))}
              {values.length > 2 && <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>+{values.length - 2}</span>}
            </div>
          ) : (
            <span style={{ color: 'var(--estate-text-muted)' }}>—</span>
          )}
        </td>
        {/* Description */}
        <td className={CELL} style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>
          {description ? (
            <span className="line-clamp-2" title={description}>
              {descriptionIsNative && <Tag tone="amber" title="native_comment from the source — no semantic description yet">native</Tag>}{' '}
              <Highlight text={description} query={searchQuery} />
            </span>
          ) : (
            <span style={{ color: 'var(--estate-text-muted)', fontStyle: 'italic' }}>No description</span>
          )}
        </td>
        {/* Confidence */}
        <td className={CELL} style={{ textAlign: 'right' }}>
          {confidence !== null ? (
            <span style={{ ...type['code-inline'], color: confidence >= 0.8 ? 'var(--estate-ink)' : 'var(--estate-text-muted)' }} title="semantic.confidence">
              {Math.round(confidence * 100)}%
            </span>
          ) : (
            <span style={{ color: 'var(--estate-text-muted)' }}>—</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr style={{ background: 'var(--estate-hover)' }}>
          <td colSpan={COLS} style={{ padding: '4px 20px 18px 44px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: 'span 2' }}>
                <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>Semantic</span>
                <p style={{ ...type.ui, color: 'var(--estate-ink)', margin: 0 }}>{semantic.description || 'No semantic description yet.'}</p>
                {semantic.entity && (
                  <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>entity: <strong>{semantic.entity}</strong></span>
                )}
                {col.native_comment && (
                  <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>native_comment: {col.native_comment}</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>Profile</span>
                <dl style={{ ...type.ui, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', color: 'var(--estate-text-secondary)' }}>
                  <dt>null_rate</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{pct(profile.null_rate) !== null ? `${(pct(profile.null_rate)! * 100).toFixed(1)}%` : '—'}</dd>
                  <dt>distinct_est</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{formatDistinct(profile.distinct_est)}</dd>
                  {!isPii && <><dt>min</dt><dd style={{ margin: 0, color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{lo ?? '—'}</dd></>}
                  {!isPii && <><dt>max</dt><dd style={{ margin: 0, color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{hi ?? '—'}</dd></>}
                  <dt>is_nullable</dt><dd style={{ margin: 0, color: 'var(--estate-ink)' }}>{(col as any).is_nullable === false ? 'false' : 'true'}</dd>
                </dl>
              </div>
              {!isPii && values.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ ...type.eyebrow, color: 'var(--estate-text-muted)' }}>top_k</span>
                  <ol style={{ ...type.ui, margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {values.map((v, i) => (
                      <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <code style={{ ...type['code-inline'], color: 'var(--estate-ink)', overflowWrap: 'anywhere' }}>{v.value}</code>
                        {v.count !== null && <span style={{ color: 'var(--estate-text-muted)' }}>{v.count.toLocaleString()}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

type SortField = 'ordinal' | 'name' | 'null_rate' | 'distinct_est';
type SortDir = 'asc' | 'desc';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const SELECT_STYLE: React.CSSProperties = {
  ...type.ui,
  height: 32,
  backgroundColor: 'var(--estate-raised)',
  border: '1px solid var(--estate-btn-border)',
  borderRadius: 8,
  color: 'var(--estate-ink)',
  padding: '0 28px 0 10px',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238892A4' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

export default function ColumnsTable({ columns, focusColumn, onFocusClear }: ColumnsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [piiFilter, setPiiFilter] = useState<'all' | 'pii' | 'non-pii'>('all');
  const [sortField, setSortField] = useState<SortField>('ordinal');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // External focus: search for the column, then scroll to it and pulse it.
  // State is set inside timer callbacks so the effect body never sets state.
  useEffect(() => {
    if (!focusColumn) return;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const searchTimer = setTimeout(() => {
      setSearchQuery(focusColumn);
      setCurrentPage(1);
    }, 0);
    const scrollTimer = setTimeout(() => {
      const col = columns.find((c) => c.name === focusColumn);
      if (!col) return;
      setHighlightedId(col.id);
      setExpandedId(col.id);
      rowRefs.current[col.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimer = setTimeout(() => {
        setHighlightedId(null);
        onFocusClear?.();
      }, 2000);
    }, 80);
    return () => {
      clearTimeout(searchTimer);
      clearTimeout(scrollTimer);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [focusColumn, columns, onFocusClear]);

  const distinctRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const col of columns) {
      const r = col.semantic?.role;
      if (r && typeof r === 'string') roles.add(r);
    }
    return Array.from(roles).sort();
  }, [columns]);

  const piiCount = useMemo(() => columns.filter((c) => c.semantic?.pii_flag === true).length, [columns]);
  const describedCount = useMemo(() => columns.filter((c) => !!c.semantic?.description).length, [columns]);

  const filteredColumns = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let result = columns.filter((col) => {
      const profile = col.profile || {};
      const semantic = col.semantic || {};
      const isPii = semantic.pii_flag === true;
      const role = semantic.role || '';
      const description = semantic.description || col.native_comment || '';
      const values = topK(profile.top_k).map((v) => v.value);

      if (piiFilter === 'pii' && !isPii) return false;
      if (piiFilter === 'non-pii' && isPii) return false;
      if (roleFilter && role !== roleFilter) return false;
      if (q) {
        const haystack = [col.name, col.data_type || '', role, description, ...values].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'ordinal') cmp = (a.ordinal ?? 0) - (b.ordinal ?? 0);
      else if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'null_rate') cmp = (a.profile?.null_rate ?? -1) - (b.profile?.null_rate ?? -1);
      else if (sortField === 'distinct_est') cmp = (a.profile?.distinct_est ?? -1) - (b.profile?.distinct_est ?? -1);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [columns, searchQuery, roleFilter, piiFilter, sortField, sortDir]);

  const handleSortToggle = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(field === 'name' ? 'asc' : 'desc');
      return field;
    });
    setCurrentPage(1);
  }, []);

  const isFiltered = !!searchQuery || !!roleFilter || piiFilter !== 'all';
  const totalFiltered = filteredColumns.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalFiltered);
  const pagedColumns = filteredColumns.slice(startIdx, endIdx);

  const meta = `${columns.length} total · ${describedCount} described${piiCount > 0 ? ` · ${piiCount} PII` : ''}`;

  if (columns.length === 0) {
    return (
      <Card title="Columns">
        <EmptyNote>No column metadata yet. Run a structure scan to list the columns.</EmptyNote>
      </Card>
    );
  }

  const thBase: React.CSSProperties = {
    ...type.eyebrow,
    color: 'var(--estate-text-muted)',
    padding: '10px 16px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    background: 'var(--estate-th-bg, var(--estate-bg))',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  const sortTh = (field: SortField, label: string, align: 'left' | 'right' = 'left', title?: string) => {
    const active = sortField === field;
    return (
      <th
        style={{ ...thBase, textAlign: align }}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title={title}
      >
        <button
          type="button"
          onClick={() => handleSortToggle(field)}
          style={{
            ...type.eyebrow,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: active ? 'var(--estate-ink)' : 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {label}
          <span aria-hidden="true" style={{ opacity: active ? 1 : 0.35 }}>{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <Card
      title="Columns"
      meta={meta}
      flush
      actions={
        <>
          {/* Search */}
          <label
            className="flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-colors focus-within:border-[var(--brand-a)]"
            style={{ borderColor: 'var(--estate-btn-border)', background: 'var(--estate-raised)', minWidth: 220 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--estate-text-muted)' }}>
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              aria-label="Search columns"
              placeholder="Search columns, values…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="flex-1 border-none bg-transparent outline-none text-size-ui"
              style={{ color: 'var(--estate-ink)', minWidth: 0 }}
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                aria-label="Clear search"
                style={{ ...type.ui, color: 'var(--estate-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                ×
              </button>
            ) : (
              <kbd style={{ ...type.caption, color: 'var(--estate-text-muted)', border: '1px solid var(--estate-border)', borderRadius: 4, padding: '0 5px' }}>/</kbd>
            )}
          </label>

          {/* Role */}
          <Select
            style={SELECT_STYLE}
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="">All roles</option>
            {distinctRoles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>

          {/* PII segmented control */}
          {piiCount > 0 && (
            <div role="group" aria-label="Filter by personal data" style={{ display: 'inline-flex', border: '1px solid var(--estate-btn-border)', borderRadius: 8, overflow: 'hidden', height: 32 }}>
              {([['all', 'All'], ['pii', 'PII'], ['non-pii', 'No PII']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={piiFilter === v}
                  onClick={() => { setPiiFilter(v); setCurrentPage(1); }}
                  className="text-size-ui"
                  style={{
                    padding: '0 10px',
                    border: 'none',
                    cursor: 'pointer',
                    background: piiFilter === v ? 'var(--estate-active-bg)' : 'var(--estate-raised)',
                    color: piiFilter === v ? 'var(--estate-ink)' : 'var(--estate-text-muted)',
                    fontWeight: piiFilter === v ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      }
    >
      <div className="overflow-x-auto" style={{ maxHeight: 640, overflowY: 'auto' }}>
        <table className="w-full border-collapse text-size-ui" style={{ tableLayout: 'fixed', minWidth: 1040 }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '21%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr>
              {sortTh('name', 'Column')}
              <th style={thBase}>Role</th>
              {sortTh('null_rate', 'Null %', 'right', 'null_rate — share of profiled rows that are NULL')}
              {sortTh('distinct_est', 'Distinct', 'right')}
              <th style={thBase} title="Lowest → highest value in the profiled rows">Range</th>
              <th style={thBase}>Top values (top_k)</th>
              <th style={thBase}>Description</th>
              <th style={{ ...thBase, textAlign: 'right' }} title="semantic.confidence">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {filteredColumns.length === 0 ? (
              <tr>
                <td colSpan={COLS} style={{ padding: '36px 16px', textAlign: 'center', ...type.ui, color: 'var(--estate-text-muted)' }}>
                  No columns match{searchQuery ? ` “${searchQuery}”` : ''}{roleFilter ? ` with role ${roleFilter}` : ''}.{' '}
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setRoleFilter(''); setPiiFilter('all'); }}
                    style={{ ...type.ui, color: 'var(--brand-a-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : (
              pagedColumns.map((col) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  searchQuery={searchQuery}
                  highlighted={highlightedId === col.id}
                  expanded={expandedId === col.id}
                  onToggle={() => setExpandedId((id) => (id === col.id ? null : col.id))}
                  rowRef={(el) => { rowRefs.current[col.id] = el; }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 16px',
          borderTop: '1px solid var(--estate-border)',
          ...type.caption,
          color: 'var(--estate-text-muted)',
        }}
      >
        <span style={{ color: isFiltered ? 'var(--brand-a-ink)' : undefined }}>
          {totalFiltered === 0 ? 'No columns' : `${startIdx + 1}–${endIdx} of ${totalFiltered}`}
          {isFiltered ? ` (filtered from ${columns.length})` : ''}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
                className="rounded-md px-2 py-1 transition-colors hover:bg-[var(--estate-active-bg)] disabled:opacity-30"
                style={{ ...type.ui, background: 'none', border: 'none', color: 'var(--estate-ink)', cursor: safeCurrentPage <= 1 ? 'not-allowed' : 'pointer' }}
                aria-label="Previous page"
              >
                ‹ Prev
              </button>
              <span style={{ ...type.ui, color: 'var(--estate-text-secondary)' }}>
                Page {safeCurrentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                className="rounded-md px-2 py-1 transition-colors hover:bg-[var(--estate-active-bg)] disabled:opacity-30"
                style={{ ...type.ui, background: 'none', border: 'none', color: 'var(--estate-ink)', cursor: safeCurrentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                aria-label="Next page"
              >
                Next ›
              </button>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Rows
            <Select
              style={{ ...SELECT_STYLE, height: 28 }}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </label>
        </div>
      </div>
    </Card>
  );
}
