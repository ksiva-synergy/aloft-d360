'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Database, Loader2, Pencil, Plus, Search, Wrench, X } from 'lucide-react';
import type { ConstructionState } from '@/lib/construction/constructionState';
import { cn } from '@/lib/utils';

/** Saves a value; resolves with an error message, or null on success. */
export type SaveFn = (value: unknown) => Promise<string | null>;

type Datasource = ConstructionState['tools']['datasources'][number];
type Action = ConstructionState['tools']['actions'][number];

// ── Provenance badge ──────────────────────────────────────────────────────────

export function ProvenanceBadge({ state, field }: { state: ConstructionState; field: string }) {
  const source = state.provenance[field];
  const assumption = state.assumptionLedger.find((a) => a.field === field && a.status === 'assumed');
  if (assumption) {
    return (
      <Badge tone="warn" title={assumption.rationale}>
        AI guess · {Math.round(assumption.confidence * 100)}%
      </Badge>
    );
  }
  if (source === 'user') return <Badge tone="ok" title="You set this. The builder will not change it unless you ask.">You</Badge>;
  if (source === 'template') return <Badge tone="neutral" title="Carried over from your Inspector session">From Inspector</Badge>;
  if (source === 'ai') return <Badge tone="brand" title="Filled in by the builder from the conversation">AI</Badge>;
  return null;
}

function Badge({ tone, title, children }: { tone: 'ok' | 'warn' | 'brand' | 'neutral'; title?: string; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-[var(--ok-bg)] text-[var(--ok)]',
    warn: 'bg-[var(--warn-bg)] text-[var(--warn)]',
    brand: 'bg-[var(--brand-a-soft)] text-[var(--brand-a-ink)]',
    neutral: 'bg-[var(--surface-3)] text-[var(--ink-2)]',
  }[tone];
  return (
    <span title={title} className={cn('shrink-0 rounded-full px-2 py-px text-[length:var(--type-caption-size)] font-semibold', cls)}>
      {children}
    </span>
  );
}

// ── Inline text ───────────────────────────────────────────────────────────────

export function InlineText({
  value,
  placeholder,
  onSave,
  disabled,
  multiline = false,
  minLength,
  label,
  displayClassName,
}: {
  value: string;
  placeholder: string;
  onSave: SaveFn;
  disabled?: boolean;
  multiline?: boolean;
  /** Shows a live counter against this target while editing. */
  minLength?: number;
  label: string;
  displayClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (disabled) setEditing(false);
  }, [disabled]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const err = await onSave(draft);
    setSaving(false);
    setError(err);
    if (!err) setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
        className={cn(
          'group flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1 -mx-2 text-left transition-colors',
          !disabled && 'hover:border-[var(--line-1)] hover:bg-[var(--surface-1)]',
          disabled && 'cursor-default',
        )}
      >
        <span className={cn('min-w-0 flex-1', displayClassName, !value && 'italic text-[var(--ink-3)]')}>
          {value || placeholder}
        </span>
        {!disabled && <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
      </button>
    );
  }

  const inputCls =
    'w-full rounded-lg border border-[var(--brand-a)] bg-[var(--surface-1)] px-3 py-2 text-[length:var(--type-ui-regular-size)] leading-relaxed text-[var(--ink-1)] outline-none focus:ring-2 focus:ring-[var(--brand-a-soft)]';

  return (
    <div>
      {multiline ? (
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={8}
          aria-label={label}
          placeholder={placeholder}
          className={cn(inputCls, 'resize-y font-sans')}
        />
      ) : (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--brand-a)] px-2.5 text-[length:var(--type-caption-size)] font-semibold text-white disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
        <button type="button" onClick={cancel} className="h-7 rounded-md px-2 text-[length:var(--type-caption-size)] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
          Cancel
        </button>
        <span className="ml-auto text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
          {minLength !== undefined && (
            <span className={cn('tabular-nums', draft.trim().length >= minLength ? 'text-[var(--ok)]' : 'text-[var(--warn)]')}>
              {draft.trim().length}/{minLength}+ ·{' '}
            </span>
          )}
          {multiline ? 'Ctrl+Enter to save' : 'Enter to save'} · Esc to cancel
        </span>
      </div>
      {error && <p role="alert" className="mt-1 text-[length:var(--type-caption-size)] text-[var(--bad)]">{error}</p>}
    </div>
  );
}

// ── Class picker ──────────────────────────────────────────────────────────────

export const CLASS_OPTIONS: Array<{ id: string; name: string; hint: string }> = [
  { id: 'feynman', name: 'Feynman', hint: 'Compliance and audit: checks records against rules' },
  { id: 'fermi', name: 'Fermi', hint: 'Forecasting and planning: estimates with confidence' },
  { id: 'grossmann', name: 'Grossmann', hint: 'Multi-step operational pipelines' },
  { id: 'rama', name: 'Rama', hint: 'Validation: verifies claims against evidence' },
];

export function ClassPicker({ value, onSave, disabled }: { value: string | null; onSave: SaveFn; disabled?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = value && !CLASS_OPTIONS.some((o) => o.id === value)
    ? [...CLASS_OPTIONS, { id: value, name: value, hint: 'Custom class' }]
    : CLASS_OPTIONS;
  const current = options.find((o) => o.id === value);

  return (
    <div>
      <div className="flex items-center gap-2">
        <select
          value={value ?? ''}
          disabled={disabled || saving}
          aria-label="Agent class"
          onChange={async (e) => {
            if (!e.target.value) return;
            setSaving(true);
            setError(await onSave(e.target.value));
            setSaving(false);
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-[length:var(--type-ui-regular-size)] text-[var(--ink-1)] disabled:opacity-70"
        >
          {!value && <option value="">Choose a class…</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-[var(--ink-3)]" />}
      </div>
      {current && <p className="mt-1 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">{current.hint}</p>}
      {error && <p role="alert" className="mt-1 text-[length:var(--type-caption-size)] text-[var(--bad)]">{error}</p>}
    </div>
  );
}

// ── Datasources ───────────────────────────────────────────────────────────────

type CatalogHit = { full_path: string; semantic_summary?: string | null };
const QUALIFIED_PATH = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

export function DatasourceEditor({ items, onSave, disabled }: { items: Datasource[]; onSave: SaveFn; disabled?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/agent-lab/context/objects?q=${encodeURIComponent(query.trim())}&pageSize=6`, { signal: ctrl.signal });
        const data = (await res.json()) as { data?: { items?: CatalogHit[] } };
        setHits(data.data?.items ?? []);
      } catch {
        if (!ctrl.signal.aborted) setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, adding]);

  const save = async (next: Datasource[]) => {
    setBusy(true);
    const err = await onSave(next);
    setBusy(false);
    setError(err);
    return err;
  };

  const add = async (ref: string) => {
    if (items.some((d) => d.ref === ref)) {
      setError('Already added');
      return;
    }
    const err = await save([...items, { kind: 'databricks', ref, scope: null }]);
    if (!err) {
      setQuery('');
      setAdding(false);
    }
  };

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-[length:var(--type-ui-regular-size)] italic text-[var(--ink-3)]">None yet. Add the tables this agent should answer from.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((d, i) => (
            <li key={`${d.kind}-${d.ref}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2">
              <Database className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[length:var(--type-ui-regular-size)] font-medium" title={d.ref}>{d.ref}</p>
                {d.scope && <p className="truncate text-[length:var(--type-caption-size)] text-[var(--ink-3)]">{d.scope}</p>}
              </div>
              <span className="shrink-0 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--ink-2)]">{d.kind}</span>
              {!disabled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(items.filter((_, j) => j !== i))}
                  aria-label={`Remove ${d.ref}`}
                  className="rounded p-0.5 text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--bad)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (adding ? (
        <div className="mt-2 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] p-2">
          <div className="flex items-center gap-2 rounded-md border border-[var(--line-1)] px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false);
                if (e.key === 'Enter' && QUALIFIED_PATH.test(query.trim())) void add(query.trim());
              }}
              placeholder="Search harvested tables, e.g. bunker"
              aria-label="Search tables"
              className="h-8 min-w-0 flex-1 bg-transparent text-[length:var(--type-ui-regular-size)] outline-none"
            />
            {(searching || busy) && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ink-3)]" />}
            <button type="button" onClick={() => setAdding(false)} aria-label="Close search" className="text-[var(--ink-3)] hover:text-[var(--ink-1)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {hits.length > 0 && (
            <ul className="mt-1.5 max-h-56 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.full_path}>
                  <button
                    type="button"
                    onClick={() => void add(h.full_path)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                  >
                    <p className="truncate text-[length:var(--type-caption-size)] font-medium">{h.full_path}</p>
                    {h.semantic_summary && <p className="line-clamp-1 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">{h.semantic_summary}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searching && query.trim().length >= 2 && hits.length === 0 && (
            <p className="px-1 pt-1.5 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
              No harvested table matches. Type a full <code>catalog.schema.table</code> path and press Enter to add it anyway.
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAdding(true); setError(null); }}
          className="mt-2 inline-flex items-center gap-1 text-[length:var(--type-caption-size)] font-medium text-[var(--brand-a-ink)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add table
        </button>
      ))}
      {error && <p role="alert" className="mt-1 text-[length:var(--type-caption-size)] text-[var(--bad)]">{error}</p>}
    </div>
  );
}

// ── Tools ─────────────────────────────────────────────────────────────────────

type CatalogTool = { id: string; name: string; type: string; description: string };

function tierFor(type: string): Action['tier'] {
  if (type === 'mcp') return 'mcp';
  if (type === 'skill') return 'skill';
  if (type === 'db_query' || type === 'api') return 'governed';
  return 'local';
}

export function ToolEditor({ items, onSave, disabled }: { items: Action[]; onSave: SaveFn; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogTool[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || catalog) return;
    fetch('/api/agent-lab/workbench/tools')
      .then((r) => r.json())
      .then((d: { tools?: CatalogTool[] }) => setCatalog(d.tools ?? []))
      .catch(() => setCatalog([]));
  }, [open, catalog]);

  const save = async (next: Action[]) => {
    setBusy(true);
    setError(await onSave(next));
    setBusy(false);
  };

  const names = new Map((catalog ?? []).map((t) => [t.id, t.name]));
  const available = (catalog ?? []).filter((t) => !items.some((a) => a.toolId === t.id));

  return (
    <div>
      <p className="mb-2 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
        The builder researches harvested data while planning; test runs use read-only Databricks access. Add active catalog tools the agent needs below.
      </p>
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li key={a.toolId} className="flex items-center gap-2.5 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-3 py-2">
              <Wrench className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
              <p className="min-w-0 flex-1 truncate text-[length:var(--type-ui-regular-size)] font-medium">{names.get(a.toolId) ?? a.toolId}</p>
              <span className="shrink-0 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[length:var(--type-caption-size)] font-semibold uppercase tracking-wide text-[var(--ink-2)]">{a.tier}</span>
              {!disabled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(items.filter((x) => x.toolId !== a.toolId))}
                  aria-label={`Remove ${a.toolId}`}
                  className="rounded p-0.5 text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--bad)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (open ? (
        <div className="mt-2 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] p-1.5">
          {catalog === null ? (
            <p className="flex items-center gap-2 px-2 py-1.5 text-[length:var(--type-caption-size)] text-[var(--ink-3)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tools…</p>
          ) : available.length === 0 ? (
            <p className="px-2 py-1.5 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">No more active tools in the catalog.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {available.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { void save([...items, { toolId: t.id, tier: tierFor(t.type) }]); setOpen(false); }}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                  >
                    <p className="truncate text-[length:var(--type-caption-size)] font-medium">{t.name}</p>
                    {t.description && <p className="line-clamp-1 text-[length:var(--type-caption-size)] text-[var(--ink-3)]">{t.description}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setOpen(false)} className="mt-1 w-full rounded-md py-1 text-[length:var(--type-caption-size)] text-[var(--ink-3)] hover:bg-[var(--surface-2)]">Close</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setOpen(true); setError(null); }}
          className="mt-2 inline-flex items-center gap-1 text-[length:var(--type-caption-size)] font-medium text-[var(--brand-a-ink)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add tool
        </button>
      ))}
      {error && <p role="alert" className="mt-1 text-[length:var(--type-caption-size)] text-[var(--bad)]">{error}</p>}
    </div>
  );
}
