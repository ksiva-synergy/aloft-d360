'use client';

/**
 * Shared building blocks for the Catalog tab (All objects + Scanned views):
 * formatting, the object-name cell, the catalog/schema tree and a small
 * overflow menu. Keeps both views visually identical.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Eye, Layers, MoreHorizontal, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatCompactCount(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));
  if (n >= 1e9) return `${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(n);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '\u2014';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatFull(iso: string | null | undefined): string | undefined {
  return iso ? new Date(iso).toLocaleString() : undefined;
}

// ── Object name cell ─────────────────────────────────────────────────────────

function kindIcon(kind: string | null | undefined) {
  const k = (kind ?? '').toLowerCase();
  if (k.includes('materialized')) return { Icon: Layers, label: 'Materialized view' };
  if (k.includes('view')) return { Icon: Eye, label: 'View' };
  if (k === 'external') return { Icon: Table2, label: 'External table' };
  return { Icon: Table2, label: 'Table' };
}

/** Kind icon + dim `catalog.schema.` prefix + emphasised object name. */
export function ObjectNameCell({ path, kind }: { path: string; kind?: string | null }) {
  const parts = path.split('.');
  const name = parts.pop() ?? path;
  const prefix = parts.length ? `${parts.join('.')}.` : '';
  const { Icon, label } = kindIcon(kind);
  return (
    <span className="flex min-w-0 items-center gap-2" title={`${path} \u00b7 ${label}`}>
      <Icon aria-label={label} className="size-3.5 shrink-0 text-[var(--estate-text-dim)]" strokeWidth={1.75} />
      <span className="min-w-0 truncate font-mono text-ui-regular">
        <span className="text-[var(--estate-text-dim)]">{prefix}</span>
        <span className="text-[var(--estate-ink)]">{name}</span>
      </span>
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export const CATALOG_BTN =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-ctl border border-[var(--estate-btn-border)] bg-transparent px-2.5 text-label text-[var(--estate-text-secondary)] transition-colors duration-hover hover:border-[var(--estate-text-muted)] hover:text-[var(--estate-ink)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

export const CATALOG_BTN_PRIMARY =
  'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-ctl bg-[var(--brand-a)] px-3 text-label text-[var(--on-brand)] shadow-xs transition-opacity duration-hover hover:opacity-90 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

export const CATALOG_SELECT =
  'h-9 cursor-pointer appearance-none rounded-ctl border border-[var(--estate-border)] bg-[var(--estate-surface)] bg-[length:8px_5px] bg-[position:right_12px_center] bg-no-repeat pl-3 pr-8 text-ui text-[var(--estate-text-secondary)] outline-none focus-visible:shadow-[var(--focus-ring)]';

export const CATALOG_SELECT_ARROW = {
  backgroundImage:
    "url(\"data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23858a93'/%3E%3C/svg%3E\")",
} as const;

// ── Overflow menu ────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function OverflowMenu({ items, label = 'More actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(CATALOG_BTN, 'h-8 w-8 justify-center px-0')}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-card border border-[var(--estate-border)] bg-[var(--estate-raised)] p-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={cn(
                'flex w-full flex-col items-start rounded-xs px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--estate-hover)] disabled:cursor-not-allowed disabled:opacity-50',
                it.danger ? 'text-[var(--bad)]' : 'text-[var(--estate-ink)]',
              )}
            >
              <span className="text-ui">{it.label}</span>
              {it.hint && <span className="text-caption text-[var(--estate-text-muted)]">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Catalog / schema tree ────────────────────────────────────────────────────

export interface TreeCatalog { name: string; count: number; scanned?: number }
export interface TreeSchema { catalog: string; name: string; count: number; scanned?: number; hint?: string }

interface FacetTreeViewProps {
  title: string;
  allLabel: string;
  total: number;
  catalogs: TreeCatalog[];
  schemas: TreeSchema[];
  loading: boolean;
  selectedCatalog?: string;
  selectedSchema?: string;
  onSelect: (catalog?: string, schema?: string) => void;
  /** Show a "scanned of total" bar per row (needs `scanned` on rows). */
  showCoverage?: boolean;
  /** Optional per-schema checkboxes (multi-schema selection). */
  schemaCheck?: { isChecked: (key: string) => boolean; toggle: (catalog: string, schema: string) => void; label: string };
  footnote?: React.ReactNode;
}

const VISIBLE_CATALOGS = 12;

function Coverage({ scanned, count }: { scanned: number; count: number }) {
  const pct = count > 0 ? Math.min(100, Math.round((scanned / count) * 100)) : 0;
  return (
    <span
      className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--estate-text-dim)_18%,transparent)]"
      title={`${scanned.toLocaleString()} of ${count.toLocaleString()} scanned (${pct}%)`}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${pct}%`, background: pct === 100 ? 'var(--ok)' : 'var(--brand-a)' }}
      />
    </span>
  );
}

export function FacetTreeView({
  title,
  allLabel,
  total,
  catalogs,
  schemas,
  loading,
  selectedCatalog,
  selectedSchema,
  onSelect,
  showCoverage = false,
  schemaCheck,
  footnote,
}: FacetTreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (selectedCatalog) setExpanded((prev) => (prev.has(selectedCatalog) ? prev : new Set([...prev, selectedCatalog])));
  }, [selectedCatalog]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const visible = showAll ? catalogs : catalogs.slice(0, VISIBLE_CATALOGS);
  const hidden = catalogs.length - visible.length;
  const allScanned = catalogs.reduce((s, c) => s + (c.scanned ?? 0), 0);
  const allCount = catalogs.reduce((s, c) => s + c.count, 0);

  const rowCls = (active: boolean) =>
    cn(
      'group relative flex w-full items-start gap-1.5 rounded-xs px-2 py-1.5 text-left transition-colors',
      active
        ? 'bg-[var(--estate-active-bg)] text-[var(--estate-ink)]'
        : 'text-[var(--estate-text-secondary)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]',
    );
  const activeBar = <span aria-hidden className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-[var(--brand-a)]" />;
  const countCls = 'shrink-0 pt-px text-caption tabular-nums text-[var(--estate-text-muted)]';

  return (
    <nav
      aria-label={title}
      className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--estate-border)] bg-[var(--estate-bg)] px-2 py-3"
    >
      <div className="flex items-center justify-between px-2 pb-2 text-caption font-medium uppercase tracking-wide text-[var(--estate-text-muted)]">
        <span>{title}</span>
        <span className="tabular-nums">{catalogs.length}</span>
      </div>

      <button type="button" onClick={() => onSelect(undefined, undefined)} className={rowCls(!selectedCatalog)}>
        {!selectedCatalog && activeBar}
        <span className="min-w-0 flex-1 pl-5">
          <span className="block truncate text-ui">{allLabel}</span>
          {showCoverage && allCount > 0 && <Coverage scanned={allScanned} count={allCount} />}
        </span>
        <span className={countCls}>{(allCount || total).toLocaleString()}</span>
      </button>

      {loading ? (
        <div className="mt-2 space-y-1.5 px-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded-xs bg-[color:color-mix(in_srgb,var(--line-2)_12%,transparent)]" />
          ))}
        </div>
      ) : (
        <ul className="mt-0.5 space-y-px">
          {visible.map((cat) => {
            const isOpen = expanded.has(cat.name);
            const active = selectedCatalog === cat.name && !selectedSchema;
            const catSchemas = schemas.filter((s) => s.catalog === cat.name);
            return (
              <li key={cat.name}>
                <div className={rowCls(active)}>
                  {active && activeBar}
                  <button
                    type="button"
                    aria-label={isOpen ? `Collapse ${cat.name}` : `Expand ${cat.name}`}
                    aria-expanded={isOpen}
                    onClick={() => toggle(cat.name)}
                    className="-m-1 mt-[-2px] shrink-0 rounded-xs p-1 text-[var(--estate-text-dim)] hover:text-[var(--estate-ink)]"
                  >
                    <ChevronRight className={cn('size-3.5 transition-transform duration-hover', isOpen && 'rotate-90')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { onSelect(cat.name, undefined); if (!isOpen) toggle(cat.name); }}
                    className="min-w-0 flex-1 text-left"
                    title={cat.name}
                  >
                    <span className={cn('block truncate text-ui', active && 'font-medium')}>{cat.name}</span>
                    {showCoverage && cat.scanned !== undefined && <Coverage scanned={cat.scanned} count={cat.count} />}
                  </button>
                  <span className={countCls}>{cat.count.toLocaleString()}</span>
                </div>

                {isOpen && catSchemas.length > 0 && (
                  <ul className="mb-1 ml-[18px] space-y-px border-l border-[var(--estate-border)] pl-1.5">
                    {catSchemas.map((sch) => {
                      const sActive = selectedCatalog === cat.name && selectedSchema === sch.name;
                      const key = `${cat.name}.${sch.name}`;
                      return (
                        <li key={sch.name} className="flex items-start gap-1">
                          {schemaCheck && (
                            <input
                              type="checkbox"
                              checked={schemaCheck.isChecked(key)}
                              onChange={() => schemaCheck.toggle(cat.name, sch.name)}
                              title={schemaCheck.label}
                              aria-label={`${schemaCheck.label}: ${key}`}
                              className="mt-2 size-3.5 shrink-0 cursor-pointer accent-[var(--brand-a)]"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onSelect(cat.name, sch.name)}
                            className={cn(rowCls(sActive), 'py-1')}
                            title={sch.hint ?? sch.name}
                          >
                            {sActive && activeBar}
                            <span className="min-w-0 flex-1">
                              <span className={cn('block truncate text-ui-regular', sActive && 'font-medium')}>{sch.name}</span>
                              {showCoverage && sch.scanned !== undefined && <Coverage scanned={sch.scanned} count={sch.count} />}
                            </span>
                            <span className={countCls}>{sch.count.toLocaleString()}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full rounded-xs px-2 py-1.5 pl-7 text-left text-ui-regular text-[var(--estate-text-muted)] hover:bg-[var(--estate-hover)] hover:text-[var(--estate-ink)]"
              >
                Show {hidden} more
              </button>
            </li>
          )}
        </ul>
      )}

      {footnote && <div className="mt-auto px-2 pt-4 text-caption text-[var(--estate-text-muted)]">{footnote}</div>}
    </nav>
  );
}
