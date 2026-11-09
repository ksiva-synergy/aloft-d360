'use client';

import { Select } from '@/components/form/Select';
import { DatePicker } from '@/components/form/DatePicker';
import { Button } from '@/components/ui/button';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from '@/lib/navigation';
import { useSession } from 'next-auth/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { canViewAgentOpsRole } from '@/lib/agent-ops/role-gate';
import {
  Search, Pin, PinOff, Trash2, MessageSquare, AlertCircle, Plus, X, Check, Minus,
  Pencil, ArrowUp, ArrowRight, ArrowUpRight, Layers, Database, RefreshCw, Activity, Bot,
  GraduationCap, SearchX, Loader2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { normalizeSurface, sessionOpenHref, type SessionSurface } from '@/lib/sessions/surfaces';

interface Session {
  id: string;
  title: string | null;
  artifact_type: string | null;
  message_count: number | null;
  last_message: string | null;
  pinned: boolean | null;
  saved_agent_id: string | null;
  modality: string | null;
  readiness: string | null;
  surface: string | null;
  context_mode: string | null;
  updated_at: string;
  created_at: string;
  progress: Record<string, unknown> | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
}

type SortKey = 'recent' | 'oldest' | 'pinned' | 'messages';
type TypeFilter = 'all' | 'agent' | 'tool' | 'schema' | 'prompt' | 'drafts';
type SurfaceFilter = 'all' | SessionSurface;

const TYPE_LABEL: Record<string, string> = { agent: 'Agent', tool: 'Tool', schema: 'Schema', prompt: 'Prompt' };

const SURFACE_META: Record<SessionSurface, { name: string; Icon: typeof Layers; tile: string }> = {
  workbench: { name: 'Workbench',  Icon: Layers,        tile: 'bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink)]' },
  inspector: { name: 'Ask Data',  Icon: Database,      tile: 'bg-[var(--brand-b-soft)] text-[var(--brand-b-ink)]' },
  teach:     { name: 'Teach',      Icon: GraduationCap, tile: 'bg-[var(--ok-bg)] text-[var(--ok)]' },
  agent_use: { name: 'Agent chat', Icon: Bot,           tile: 'bg-[var(--warn-bg)] text-[var(--warn)]' },
};
const SURFACE_ORDER: SessionSurface[] = ['workbench', 'inspector', 'teach', 'agent_use'];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Convert a glob pattern (* and ?) to a RegExp */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped, 'i');
}

function matchesGlob(pattern: string, ...targets: (string | null | undefined)[]): boolean {
  if (!pattern.trim()) return true;
  const hasGlob = pattern.includes('*') || pattern.includes('?');
  if (hasGlob) {
    const rx = globToRegex(pattern);
    return targets.some(t => t && rx.test(t));
  }
  const q = pattern.toLowerCase();
  return targets.some(t => t && t.toLowerCase().includes(q));
}

function isDraft(s: Session): boolean {
  return (s.message_count ?? 0) === 0;
}

/**
 * Auto-titles are the first message cut short ("can you get me this week sir..."). When the title is
 * just a prefix of the preview, show the full message once instead of the same text twice.
 */
function titleAndPreview(s: Session): { title: string; preview: string | null } {
  const title = s.title?.trim() || '';
  const preview = s.last_message?.trim() || null;
  if (!title) return { title: preview ?? 'Untitled conversation', preview: null };
  if (!preview) return { title, preview: null };
  const core = title.replace(/(\.\.\.|…)$/, '').trim().toLowerCase();
  if (core && preview.toLowerCase().startsWith(core)) return { title: preview, preview: null };
  return { title, preview };
}

type DateGroup = 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Older';

function dateGroup(iso: string): DateGroup {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return 'This week';
  if (d < 30) return 'This month';
  return 'Older';
}

const DATE_GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This week', 'This month', 'Older'];

const ROW_HEIGHT = 64;
const GROUP_HEIGHT = 36;

const MODEL_LABELS: Record<string, { short: string; color: string }> = {
  // Keys matching AVAILABLE_MODELS (workbench/types.ts) — these are stored in progress.last_model
  'opus-5-5':          { short: 'Opus 5.5',    color: '#a78bfa' },
  'sonnet-5-5':        { short: 'Sonnet 5.5',  color: '#60a5fa' },
  'opus-4-6':          { short: 'Opus 4.6',    color: '#c4b5fd' },
  'sonnet-4-6':        { short: 'Sonnet 4.6',  color: '#93C5FD' },
  'haiku-4-5':         { short: 'Haiku 4.5',   color: '#6ee7b7' },
  'mistral-l3':        { short: 'Mistral L3',  color: '#a5b4fc' },
  'qwen3-32b':         { short: 'Qwen3',       color: '#67e8f9' },
  'gpt-5-4':           { short: 'GPT-5.4',     color: '#6BC5B0' },
  'gpt-6-luna':        { short: 'GPT-6 Luna',  color: '#7DD3C0' },
  'grok-4-3':          { short: 'Grok 4.3',    color: '#E8A838' },
  'grok-xai':          { short: 'Grok 4.6',    color: '#E8A838' },
  'kimi-k2-6':         { short: 'Kimi K2.6',   color: '#D4605A' },
  'deepseek-v4':       { short: 'DeepSeek V4', color: '#f9a8d4' },
  'nova-premier':      { short: 'Nova Premier', color: '#fdba74' },
  'nova-pro':          { short: 'Nova Pro',     color: '#fdba74' },
  'nova-lite':         { short: 'Nova Lite',    color: '#fcd34d' },
  'nova-micro':        { short: 'Nova Micro',   color: '#fcd34d' },
  'llama-4-maverick':  { short: 'Llama 4 Mav', color: '#86EFAC' },
  'llama-4-scout':     { short: 'Llama 4 Scout',color: '#86EFAC' },
  'llama-3-3-70b':     { short: 'Llama 3.3',   color: '#86EFAC' },
  'deepseek-r1':       { short: 'DeepSeek R1', color: '#f9a8d4' },
  // Legacy keys (older inspector route format)
  'claude-opus':       { short: 'Opus',        color: '#c4b5fd' },
  'claude-sonnet':     { short: 'Sonnet',       color: '#93C5FD' },
  'claude-haiku':      { short: 'Haiku',        color: '#6ee7b7' },
  'mistral-large-3':   { short: 'Mistral L',   color: '#a5b4fc' },
};

function modelLabel(key: string | undefined): { short: string; color: string } | null {
  if (!key) return null;
  return MODEL_LABELS[key] ?? { short: key, color: 'var(--ink-3)' };
}

const AVATAR_TONES = [
  'bg-[color-mix(in_srgb,var(--brand-a)_16%,transparent)] text-[var(--brand-a-ink)]',
  'bg-[var(--brand-b-soft)] text-[var(--brand-b-ink)]',
  'bg-[var(--ok-bg)] text-[var(--ok)]',
  'bg-[var(--warn-bg)] text-[var(--warn)]',
  'bg-[color-mix(in_srgb,var(--brand-c)_16%,transparent)] text-[color-mix(in_srgb,var(--brand-c)_55%,var(--ink-1))]',
];

function initials(name: string): string {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function avatarTone(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Filter controls share one look; `on` marks a control that is narrowing the list. */
const CONTROL = 'h-9 rounded-ctl border bg-[var(--surface-1)] px-3 text-ui-regular transition-colors duration-hover hover:border-[var(--line-2)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]';
const controlTone = (on: boolean) => on
  ? 'border-[color-mix(in_srgb,var(--brand-a)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-a)_6%,var(--surface-1))] text-[var(--ink-1)]'
  : 'border-[var(--line-1)] text-[var(--ink-2)]';

type VirtualItem =
  | { kind: 'group'; label: DateGroup; count: number }
  | { kind: 'session'; session: Session };

export default function ChatHistoryPage() {
  const router = useRouter();
  const { data: authSession } = useSession();
  const showAgentOpsTrace = canViewAgentOpsRole(authSession?.user?.role);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  // Whether the current user (platform_admin) may view all users' sessions.
  const [canReadAll, setCanReadAll] = useState(false);
  // Persisted preference: platform admins default to viewing all users' sessions.
  const [scopeAll, setScopeAll] = useState(true);
  const [hideDrafts, setHideDrafts] = useState(true);

  useEffect(() => {
    setScopeAll(localStorage.getItem('history-scope-all') !== 'false');
    const stored = localStorage.getItem('history-hide-drafts');
    setHideDrafts(stored === null ? true : stored === 'true');
  }, []);
  const [pinning, setPinning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // Agent chats are not listed here: each person finds theirs on the agent's page ("Your chats"),
    // and admins review other people's there in a separate list.
    fetch(`/api/agent-lab/workbench/sessions?scope=${scopeAll ? 'all' : 'mine'}&surface=workbench,inspector,teach`)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(data => {
        setSessions(data.sessions ?? []);
        setCanReadAll(Boolean(data.canReadAll));
        setLoading(false);
      })
      .catch(() => { setError('Could not load history. Please try again.'); setLoading(false); });
  }, [scopeAll]);

  useEffect(() => { load(); }, [load]);

  const setScope = (all: boolean) => {
    if (all === scopeAll) return;
    localStorage.setItem('history-scope-all', String(all));
    setScopeAll(all);
  };

  // Re-fetch when the tab becomes visible again (user switches back to this tab)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  // Re-fetch when the window regains focus (e.g. user returns from another window)
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // "/" focuses search, as in most list views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleHideDrafts = () => {
    setHideDrafts(prev => {
      const next = !prev;
      localStorage.setItem('history-hide-drafts', String(next));
      return next;
    });
  };

  // Sessions after the drafts rule only — the base the surface tab counts are taken from.
  const visibleBase = useMemo(() => {
    if (typeFilter === 'drafts') return sessions.filter(isDraft);
    return hideDrafts ? sessions.filter(s => !isDraft(s)) : sessions;
  }, [sessions, typeFilter, hideDrafts]);

  const surfaceCounts = useMemo(() => {
    const counts = new Map<SessionSurface, number>();
    for (const s of visibleBase) {
      const k = normalizeSurface(s.surface);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [visibleBase]);

  const filtered = useMemo(() => {
    let list = [...visibleBase];
    if (typeFilter !== 'all' && typeFilter !== 'drafts') list = list.filter(s => (s.artifact_type ?? 'agent') === typeFilter);
    // Surface filter: null surface → treat as 'workbench' (pre-Inspector sessions)
    if (surfaceFilter !== 'all') list = list.filter(s => normalizeSurface(s.surface) === surfaceFilter);
    if (userFilter !== 'all') list = list.filter(s => s.user_id === userFilter);
    if (modelFilter !== 'all') list = list.filter(s => (s.progress?.last_model as string | undefined) === modelFilter);
    if (fromDate) {
      const t = new Date(fromDate).getTime();
      list = list.filter(s => new Date(s.created_at).getTime() >= t);
    }
    if (toDate) {
      const t = new Date(toDate).getTime() + 86400000; // inclusive of the whole end day
      list = list.filter(s => new Date(s.created_at).getTime() < t);
    }
    if (query.trim()) {
      list = list.filter(s => matchesGlob(query, s.title, s.last_message, s.user_name, s.user_email));
    }
    switch (sort) {
      case 'oldest':   list.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)); break;
      case 'pinned':   list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); break;
      case 'messages': list.sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0)); break;
      default:         list.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)); break;
    }
    return list;
  }, [visibleBase, query, sort, typeFilter, surfaceFilter, userFilter, modelFilter, fromDate, toDate]);

  // Distinct users present in the loaded set (for the User filter dropdown).
  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      if (s.user_id && !map.has(s.user_id)) {
        map.set(s.user_id, s.user_name || s.user_email || s.user_id);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions]);

  // Distinct models present in the loaded set (for the Model filter dropdown).
  const modelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const m = s.progress?.last_model as string | undefined;
      if (m) set.add(m);
    }
    return [...set].map(k => ({ key: k, label: modelLabel(k)?.short ?? k })).sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  const virtualItems = useMemo((): VirtualItem[] => {
    if (sort !== 'recent' && sort !== 'oldest') {
      return filtered.map(s => ({ kind: 'session' as const, session: s }));
    }
    const groups = new Map<DateGroup, Session[]>();
    for (const s of filtered) {
      const g = dateGroup(s.updated_at);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }
    const order = sort === 'oldest' ? [...DATE_GROUP_ORDER].reverse() : DATE_GROUP_ORDER;
    const result: VirtualItem[] = [];
    for (const g of order) {
      const sessions = groups.get(g);
      if (sessions && sessions.length > 0) {
        result.push({ kind: 'group', label: g, count: sessions.length });
        for (const s of sessions) result.push({ kind: 'session', session: s });
      }
    }
    return result;
  }, [filtered, sort]);

  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => virtualItems[i]?.kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT,
    overscan: 8,
  });

  const draftCount = useMemo(() => sessions.filter(isDraft).length, [sessions]);

  const allVisibleSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const someVisibleSelected = filtered.some(s => selected.has(s.id));
  const someSelected = selected.size > 0;
  const showOwner = canReadAll && scopeAll;

  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map(s => s.id)));
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelection = () => { setSelected(new Set()); setBulkConfirm(false); };

  const filtersActive = Boolean(query.trim()) || typeFilter !== 'all' || userFilter !== 'all' || modelFilter !== 'all' || Boolean(fromDate) || Boolean(toDate);
  const clearFilters = () => {
    setQuery(''); setTypeFilter('all'); setUserFilter('all'); setModelFilter('all'); setFromDate(''); setToDate('');
  };

  const handleBulkDelete = async () => {
    if (bulkDeleting || selected.size === 0) return;
    setBulkDeleting(true); setBulkConfirm(false);
    try {
      const ids = Array.from(selected);
      const res = await fetch('/api/agent-lab/workbench/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (res.ok) { setSessions(prev => prev.filter(s => !ids.includes(s.id))); setSelected(new Set()); }
    } finally { setBulkDeleting(false); }
  };

  const handleSingleDelete = async (id: string) => {
    const res = await fetch(`/api/agent-lab/workbench/sessions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSessions(prev => prev.filter(s => s.id !== id));
      setSelected(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handlePin = async (session: Session) => {
    if (pinning) return;
    setPinning(session.id);
    const newPinned = !session.pinned;
    try {
      await fetch(`/api/agent-lab/workbench/sessions/${session.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: newPinned }) });
      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, pinned: newPinned } : s));
    } finally { setPinning(null); }
  };

  const handleRename = async (id: string, newTitle: string) => {
    const t = newTitle.trim();
    if (!t) return;
    await fetch(`/api/agent-lab/workbench/sessions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: t } : s));
  };

  const newChat = () => router.push('/agent-lab/agents/workbench');

  // Model and owner columns drop out on narrow screens (see .hist-wide below).
  const cols = [
    '28px', 'minmax(0,1fr)', '150px', '76px',
    ...(showOwner ? ['180px'] : []),
    '168px',
  ];
  const narrowCols = ['28px', 'minmax(0,1fr)', '76px', '168px'];
  const gridVars = { '--hist-cols': cols.join(' '), '--hist-cols-sm': narrowCols.join(' ') } as React.CSSProperties;

  const surfaceTabs: SurfaceFilter[] = ['all', ...SURFACE_ORDER.filter(s => surfaceCounts.has(s) || surfaceFilter === s)];

  return (
    <div className="flex h-full flex-col overflow-hidden" style={gridVars}>
      {/* Page header */}
      <header className="shrink-0 px-4 pt-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="m-0 text-title-page text-[var(--ink-1)]">Chat history</h1>
            <p className="mt-1 text-ui-regular text-[var(--ink-3)]">
              Pick up any Workbench or Ask Data conversation where you left off.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canReadAll && (
              <div role="radiogroup" aria-label="Whose chats" title="Platform admins can view every user's sessions"
                className="inline-flex h-9 items-center rounded-ctl border border-[var(--line-1)] bg-[var(--surface-2)] p-0.5">
                {([[false, 'My chats'], [true, 'Everyone']] as const).map(([all, label]) => {
                  const active = all === scopeAll;
                  return (
                    <button key={label} type="button" role="radio" aria-checked={active} onClick={() => setScope(all)}
                      className={cn(
                        'h-full rounded-xs px-3 text-ui transition-colors duration-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                        active ? 'bg-[var(--surface-1)] text-[var(--ink-1)] shadow-xs' : 'text-[var(--ink-3)] hover:text-[var(--ink-1)]',
                      )}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <Button variant="outline" size="icon" className="size-9" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
            <Button onClick={newChat} icon={<Plus className="size-4" />}>New chat</Button>
          </div>
        </div>

        {/* Surface tabs */}
        <nav aria-label="Surface" className="mt-5 flex items-center gap-1 overflow-x-auto border-b border-[var(--line-1)]">
          {surfaceTabs.map(sf => {
            const active = surfaceFilter === sf;
            const count = sf === 'all' ? visibleBase.length : surfaceCounts.get(sf) ?? 0;
            const Icon = sf === 'all' ? null : SURFACE_META[sf].Icon;
            return (
              <button key={sf} type="button" aria-current={active ? 'page' : undefined} onClick={() => setSurfaceFilter(sf)}
                className={cn(
                  'relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-ui transition-colors duration-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                  active ? 'border-[var(--brand-a)] text-[var(--ink-1)]' : 'border-transparent text-[var(--ink-3)] hover:text-[var(--ink-1)]',
                )}>
                {Icon && <Icon className="size-4 opacity-80" aria-hidden />}
                {sf === 'all' ? 'All conversations' : SURFACE_META[sf].name}
                {!loading && (
                  <span className={cn(
                    'rounded-full px-1.5 text-caption tabular-nums',
                    active ? 'bg-[color-mix(in_srgb,var(--brand-a)_14%,transparent)] text-[var(--brand-a-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-3)]',
                  )}>{count}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 py-3">
          <div className="relative w-full sm:w-72 lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-3)]" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
              placeholder="Search titles, messages, people"
              title="Use * and ? as wildcards"
              aria-label="Search conversations"
              className={cn(CONTROL, controlTone(Boolean(query)), 'w-full pl-9 pr-9 text-[var(--ink-1)] placeholder:text-[var(--ink-3)]')}
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-xs text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]">
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[4px] border border-[var(--line-1)] px-1.5 text-caption text-[var(--ink-3)]">/</kbd>
            )}
          </div>

          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)} aria-label="Type" className={cn(CONTROL, controlTone(typeFilter !== 'all'), 'w-[132px]')}>
            <option value="all">All types</option>
            <option value="agent">Agents</option>
            <option value="tool">Tools</option>
            <option value="schema">Schemas</option>
            <option value="prompt">Prompts</option>
            <option value="drafts">Drafts only</option>
          </Select>

          {modelOptions.length > 1 && (
            <Select value={modelFilter} onChange={e => setModelFilter(e.target.value)} aria-label="Model" className={cn(CONTROL, controlTone(modelFilter !== 'all'), 'w-[148px]')}>
              <option value="all">All models</option>
              {modelOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </Select>
          )}

          {/* User filter — only useful when viewing all users' sessions */}
          {showOwner && userOptions.length > 1 && (
            <Select value={userFilter} onChange={e => setUserFilter(e.target.value)} aria-label="Owner" className={cn(CONTROL, controlTone(userFilter !== 'all'), 'w-[168px]')}>
              <option value="all">Anyone</option>
              {userOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
          )}

          {/* Date range (created) */}
          <div title="Filter by the date the conversation started"
            className={cn('inline-flex h-9 items-center gap-0.5 rounded-ctl border bg-[var(--surface-1)] px-1 text-ui-regular transition-colors duration-hover hover:border-[var(--line-2)]', controlTone(Boolean(fromDate || toDate)))}>
            <DatePicker aria-label="Started from" placeholder="Start date" value={fromDate} max={toDate || undefined} onChange={setFromDate}
              className="h-7 rounded-xs px-2 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]" />
            <ArrowRight className="size-3.5 shrink-0 text-[var(--ink-3)]" aria-hidden />
            <DatePicker aria-label="Started to" placeholder="End date" value={toDate} min={fromDate || undefined} onChange={setToDate}
              className="h-7 rounded-xs px-2 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]" />
          </div>

          {filtersActive && (
            <Button variant="ghost" size="md" onClick={clearFilters} icon={<X className="size-3.5" />}>Clear filters</Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {draftCount > 0 && typeFilter !== 'drafts' && (
              <button type="button" role="switch" aria-checked={!hideDrafts} onClick={toggleHideDrafts}
                className={cn(CONTROL, controlTone(false), 'inline-flex items-center gap-2')}>
                <span aria-hidden className={cn(
                  'relative h-4 w-7 rounded-full transition-colors duration-hover',
                  hideDrafts ? 'bg-[var(--line-2)]' : 'bg-[var(--brand-a)]',
                )}>
                  <span className={cn(
                    'absolute left-0.5 top-0.5 size-3 rounded-full bg-white shadow-xs transition-transform duration-hover ease-out-strong',
                    !hideDrafts && 'translate-x-3',
                  )} />
                </span>
                Show drafts
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-caption tabular-nums text-[var(--ink-3)]">{draftCount}</span>
              </button>
            )}
            <Select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort" className={cn(CONTROL, controlTone(false), 'w-[148px]')}>
              <option value="recent">Recently active</option>
              <option value="oldest">Oldest first</option>
              <option value="pinned">Pinned first</option>
              <option value="messages">Most messages</option>
            </Select>
          </div>
        </div>
      </header>

      {/* List */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 md:px-8">
        <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] shadow-xs">
          {/* Column headers */}
          <div className="hist-grid h-10 shrink-0 items-center gap-x-4 border-b border-[var(--line-1)] bg-[var(--surface-2)] px-4 text-label text-[var(--ink-3)]">
            <SelectBox
              checked={allVisibleSelected ? true : someVisibleSelected ? 'mixed' : false}
              onToggle={toggleSelectAll}
              disabled={loading || filtered.length === 0}
              label={allVisibleSelected ? 'Deselect all conversations' : 'Select all conversations'}
            />
            <span className="truncate">
              Conversation
              {!loading && !error && <span className="ml-1.5 tabular-nums text-[var(--ink-3)] opacity-70">{filtered.length}</span>}
            </span>
            <span className="hist-wide">Model</span>
            <span className="text-right">Messages</span>
            {showOwner && <span className="hist-wide">Owner</span>}
            <span className="text-right">Last active</span>
          </div>

          {/* Scrollable content */}
          <div
            ref={scrollRef}
            onScroll={() => setShowScrollTop((scrollRef.current?.scrollTop ?? 0) > 300)}
            className="relative min-h-0 flex-1 overflow-y-auto"
          >
            {loading && sessions.length === 0 ? (
              <SkeletonRows showOwner={showOwner} />
            ) : error ? (
              <StatusPanel
                icon={<AlertCircle className="size-5" />}
                tone="bad"
                title="History didn't load"
                body={error}
                action={<Button variant="outline" onClick={load} icon={<RefreshCw className="size-4" />}>Try again</Button>}
              />
            ) : filtered.length === 0 ? (
              sessions.length === 0 ? (
                <StatusPanel
                  icon={<MessageSquare className="size-5" />}
                  title="No conversations yet"
                  body="Start a chat in the Agent Workbench and it will show up here."
                  action={<Button onClick={newChat} icon={<Plus className="size-4" />}>Start your first chat</Button>}
                />
              ) : (
                <StatusPanel
                  icon={<SearchX className="size-5" />}
                  title="Nothing matches"
                  body={query.trim() ? <>No conversations match &ldquo;{query.trim()}&rdquo; with the current filters.</> : 'No conversations match the current filters.'}
                  action={filtersActive || surfaceFilter !== 'all'
                    ? <Button variant="outline" onClick={() => { clearFilters(); setSurfaceFilter('all'); }}>Clear filters</Button>
                    : undefined}
                />
              )
            ) : (
              <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map(vItem => {
                  const item = virtualItems[vItem.index];
                  if (!item) return null;
                  const pos = { top: vItem.start, height: vItem.size };
                  if (item.kind === 'group') {
                    return (
                      <div key={vItem.key} style={pos}
                        className="absolute inset-x-0 flex items-end gap-2 border-b border-[var(--line-1)] bg-[color-mix(in_srgb,var(--surface-2)_60%,var(--surface-1))] px-4 pb-2">
                        <span className="text-eyebrow text-[var(--ink-3)]">{item.label}</span>
                        <span className="text-caption tabular-nums text-[var(--ink-3)] opacity-70">{item.count}</span>
                      </div>
                    );
                  }
                  const s = item.session;
                  return (
                    <div key={vItem.key} style={pos} className="absolute inset-x-0">
                      <SessionRow
                        session={s}
                        showOwner={showOwner}
                        selectionMode={someSelected}
                        isSelected={selected.has(s.id)}
                        isPinning={pinning === s.id}
                        onToggleSelect={() => toggleSelect(s.id)}
                        onContinue={() => router.push(sessionOpenHref(s))}
                        onPin={() => handlePin(s)}
                        onDelete={() => handleSingleDelete(s.id)}
                        onRename={(title) => handleRename(s.id, title)}
                        onDebugTrace={showAgentOpsTrace ? () => router.push(`/agent-lab/runs/${s.id}`) : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      {someSelected && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        <div role="toolbar" aria-label="Selected conversations"
          className="pointer-events-auto flex items-center gap-2 rounded-card border border-[var(--line-1)] bg-[var(--card)] py-1.5 pl-4 pr-1.5 shadow-pop animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="whitespace-nowrap text-ui text-[var(--ink-1)]">
            <span className="tabular-nums">{selected.size}</span> selected
          </span>
          <span className="mx-1 h-5 w-px bg-[var(--line-1)]" aria-hidden />
          {bulkConfirm ? (
            <>
              <span className="whitespace-nowrap text-ui-regular text-[var(--ink-2)]">
                Delete {selected.size} conversation{selected.size !== 1 ? 's' : ''}? This can&rsquo;t be undone.
              </span>
              <Button variant="ghost" size="sm" onClick={() => setBulkConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} loading={bulkDeleting}>Delete</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
              <Button variant="destructive" size="sm" onClick={() => setBulkConfirm(true)} loading={bulkDeleting}
                icon={<Trash2 className="size-3.5" />}>Delete</Button>
            </>
          )}
        </div>
        </div>
      )}

      {/* Scroll to top */}
      {showScrollTop && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-8 z-50 size-10 rounded-full shadow-pop"
          title="Back to top"
          aria-label="Back to top"
        >
          <ArrowUp className="size-4" />
        </Button>
      )}

      <style>{`
        .hist-grid { display: grid; grid-template-columns: var(--hist-cols-sm); }
        .hist-wide { display: none; }
        @media (min-width: 1180px) {
          .hist-grid { grid-template-columns: var(--hist-cols); }
          .hist-wide { display: flex; }
        }
      `}</style>
    </div>
  );
}

function SelectBox({ checked, onToggle, label, disabled, className }: {
  checked: boolean | 'mixed';
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className={cn('group/box -m-1.5 grid size-7 place-items-center rounded-ctl focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-40', className)}
    >
      <span className={cn(
        'grid size-4 place-items-center rounded-[5px] border transition-colors duration-hover',
        checked ? 'border-[var(--brand-a)] bg-[var(--brand-a)] text-[var(--on-brand)]' : 'border-[var(--line-2)] bg-[var(--surface-1)] group-hover/box:border-[var(--ink-3)]',
      )}>
        {checked === 'mixed' ? <Minus className="size-3" strokeWidth={3} /> : checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function StatusPanel({ icon, title, body, action, tone }: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className={cn(
        'mb-4 grid size-11 place-items-center rounded-card',
        tone === 'bad' ? 'bg-[var(--bad-bg)] text-[var(--bad)]' : 'bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] text-[var(--brand-a-ink)]',
      )}>
        {icon}
      </div>
      <p className="m-0 text-title-card text-[var(--ink-1)]">{title}</p>
      <p className="mb-0 mt-1.5 max-w-sm text-ui-regular text-[var(--ink-3)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function SkeletonRows({ showOwner }: { showOwner: boolean }) {
  const bar = 'rounded-full bg-[var(--surface-3)]';
  return (
    <div aria-busy="true" aria-label="Loading conversations" className="animate-pulse">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="hist-grid items-center gap-x-4 border-b border-[var(--line-1)] px-4" style={{ height: ROW_HEIGHT }}>
          <span className="size-4 rounded-[5px] bg-[var(--surface-3)]" />
          <div className="flex min-w-0 items-center gap-3">
            <span className="size-9 shrink-0 rounded-ctl bg-[var(--surface-3)]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className={cn(bar, 'h-3')} style={{ width: `${55 - (i % 3) * 12}%` }} />
              <span className={cn(bar, 'h-2.5')} style={{ width: `${35 + (i % 4) * 8}%` }} />
            </div>
          </div>
          <span className={cn(bar, 'hist-wide h-3 w-20')} />
          <span className={cn(bar, 'ml-auto h-3 w-8')} />
          {showOwner && <span className={cn(bar, 'hist-wide h-3 w-28')} />}
          <span className={cn(bar, 'ml-auto h-3 w-16')} />
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  session: Session;
  showOwner: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  isPinning: boolean;
  onToggleSelect: () => void;
  onContinue: () => void;
  onPin: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onDebugTrace?: () => void;
}

const ICON_BTN = 'grid size-7 place-items-center rounded-ctl text-[var(--ink-3)] transition-colors duration-hover hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50';

function SessionRow({ session, showOwner, selectionMode, isSelected, isPinning, onToggleSelect, onContinue, onPin, onDelete, onRename, onDebugTrace }: RowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  const model = modelLabel(session.progress?.last_model as string | undefined);
  const surface = normalizeSurface(session.surface);
  const { name: surfaceName, Icon: SurfaceIcon, tile } = SURFACE_META[surface];
  const { title, preview } = titleAndPreview(session);
  const kind = session.artifact_type ?? 'agent';
  const draft = isDraft(session);
  const owner = session.user_name || session.user_email;
  const msgs = session.message_count ?? 0;

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.title ?? '');
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (editValue.trim() && editValue.trim() !== session.title) onRename(editValue.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') { setEditing(false); setEditValue(session.title ?? ''); }
  };

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div
      onClick={editing ? undefined : onContinue}
      data-selected={isSelected || undefined}
      className={cn(
        'hist-grid group h-full cursor-pointer items-center gap-x-4 border-b border-[var(--line-1)] px-4 transition-colors duration-hover',
        isSelected
          ? 'bg-[color-mix(in_srgb,var(--brand-a)_7%,var(--surface-1))]'
          : 'hover:bg-[color-mix(in_srgb,var(--ink-1)_3%,var(--surface-1))]',
      )}
    >
      {/* Checkbox — appears on hover until something is selected */}
      <SelectBox
        checked={isSelected}
        onToggle={onToggleSelect}
        label={isSelected ? 'Deselect conversation' : 'Select conversation'}
        className={cn(
          !selectionMode && !isSelected && 'opacity-0 transition-opacity duration-hover focus-visible:opacity-100 group-hover:opacity-100',
        )}
      />

      {/* Conversation */}
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-ctl', tile)} title={surfaceName}>
          <SurfaceIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commitEdit}
                aria-label="Conversation title"
                className="h-7 min-w-0 flex-1 rounded-xs border border-[var(--brand-a)] bg-[var(--surface-1)] px-2 text-ui text-[var(--ink-1)] shadow-[var(--focus-ring)] outline-none"
              />
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={commitEdit} aria-label="Save title" className={cn(ICON_BTN, 'text-[var(--ok)]')}><Check className="size-3.5" /></button>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setEditing(false); setEditValue(session.title ?? ''); }} aria-label="Cancel rename" className={ICON_BTN}><X className="size-3.5" /></button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className="min-w-0 truncate text-left text-ui text-[var(--ink-1)] focus-visible:underline focus-visible:outline-none">
                {title}
              </button>
              {session.pinned && <Pin className="size-3.5 shrink-0 fill-current text-[var(--brand-a)]" aria-label="Pinned" />}
              {session.saved_agent_id && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[var(--ok-bg)] px-2 text-label text-[var(--ok)]">
                  <span className="size-1.5 rounded-full bg-current" aria-hidden />Deployed
                </span>
              )}
              {draft && (
                <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--surface-2)] px-2 text-label text-[var(--ink-3)]">Draft</span>
              )}
            </div>
          )}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-[var(--ink-3)]">
            <span className="shrink-0">{surfaceName}</span>
            {kind !== 'agent' && TYPE_LABEL[kind] && <><Dot /><span className="shrink-0">{TYPE_LABEL[kind]}</span></>}
            {surface === 'inspector' && (
              <>
                <Dot />
                <span className="shrink-0" title={session.context_mode === 'warehouse_only' ? 'No catalog context used' : 'Harvested catalog context (T0/T1/T2) was used'}>
                  {session.context_mode === 'warehouse_only' ? 'SQL only' : 'Catalog + SQL'}
                </span>
              </>
            )}
            {preview && <><Dot /><span className="truncate text-[var(--ink-2)]">{preview}</span></>}
          </div>
        </div>
      </div>

      {/* Model */}
      <div className="hist-wide min-w-0 items-center gap-2">
        {model ? (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: model.color }} aria-hidden />
            <span className="truncate text-ui-regular text-[var(--ink-2)]" title={model.short}>{model.short}</span>
          </>
        ) : (
          <span className="text-ui-regular text-[var(--ink-3)]">—</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex items-center justify-end gap-1.5 text-ui-regular tabular-nums">
        {msgs > 0 ? (
          <>
            <MessageSquare className="size-3.5 text-[var(--ink-3)]" aria-hidden />
            <span className="text-[var(--ink-2)]">{msgs}</span>
          </>
        ) : (
          <span className="text-[var(--ink-3)]">—</span>
        )}
      </div>

      {/* Owner */}
      {showOwner && (
        <div className="hist-wide min-w-0 items-center gap-2">
          {owner ? (
            <>
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-caption', avatarTone(session.user_id ?? owner))} aria-hidden>
                {initials(owner)}
              </span>
              <span className="truncate text-ui-regular text-[var(--ink-2)]" title={session.user_email ?? undefined}>{owner}</span>
            </>
          ) : (
            <span className="text-ui-regular text-[var(--ink-3)]">—</span>
          )}
        </div>
      )}

      {/* Last active — swaps for actions on hover / focus */}
      <div className="relative flex h-full items-center justify-end">
        <div className={cn(
          'text-right transition-opacity duration-hover',
          confirmDelete ? 'opacity-0' : 'group-focus-within:opacity-0 group-hover:opacity-0',
        )}>
          <div className="text-ui-regular tabular-nums text-[var(--ink-2)]">{relativeTime(session.updated_at)}</div>
          <div className="text-caption text-[var(--ink-3)]">Started {shortDate(session.created_at)}</div>
        </div>
        <div
          onClick={e => e.stopPropagation()}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center gap-0.5 transition-opacity duration-hover',
            confirmDelete
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
          )}
        >
          {confirmDelete ? (
            <>
              <span className="mr-1 text-ui-regular text-[var(--ink-2)]">Delete?</span>
              <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>No</Button>
              <Button variant="destructive" size="xs" onClick={() => { setConfirmDelete(false); onDelete(); }}>Delete</Button>
            </>
          ) : (
            <>
              {onDebugTrace && (
                <button type="button" onClick={stop(onDebugTrace)} title="Debug trace (tool invocations)" aria-label="Debug trace" className={ICON_BTN}>
                  <Activity className="size-3.5" />
                </button>
              )}
              <button type="button" onClick={startEdit} title="Rename" aria-label="Rename" className={ICON_BTN}>
                <Pencil className="size-3.5" />
              </button>
              <button type="button" onClick={stop(onPin)} disabled={isPinning} title={session.pinned ? 'Unpin' : 'Pin'} aria-label={session.pinned ? 'Unpin' : 'Pin'}
                className={cn(ICON_BTN, session.pinned && 'text-[var(--brand-a)]')}>
                {isPinning ? <Loader2 className="size-3.5 animate-spin" /> : session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
              <button type="button" onClick={stop(() => setConfirmDelete(true))} title="Delete" aria-label="Delete"
                className={cn(ICON_BTN, 'hover:bg-[var(--bad-bg)] hover:text-[var(--bad)]')}>
                <Trash2 className="size-3.5" />
              </button>
              <button type="button" onClick={stop(onContinue)} title="Open" aria-label="Open conversation"
                className={cn(ICON_BTN, 'text-[var(--brand-a-ink)] hover:bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] hover:text-[var(--brand-a-ink)]')}>
                <ArrowUpRight className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-current opacity-60" />;
}
