'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useIsDark } from '@/hooks/useIsDark';
import {
  Search, Pin, PinOff, Trash2, MessageSquare,
  Loader2, AlertCircle, Plus, CheckSquare, Square, X,
  ChevronRight, Pencil, Check, ArrowUp, Layers, Database, RefreshCw, User,
} from 'lucide-react';

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
type SurfaceFilter = 'all' | 'workbench' | 'inspector';

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  agent:  { label: 'AGENT',  color: '#FDB515', bg: 'rgba(253,181,21,0.12)' },
  tool:   { label: 'TOOL',   color: '#93C5FD', bg: 'rgba(147,197,253,0.12)' },
  schema: { label: 'SCHEMA', color: '#86EFAC', bg: 'rgba(134,239,172,0.12)' },
  prompt: { label: 'PROMPT', color: '#c4b5fd', bg: 'rgba(196,181,253,0.12)' },
};

function typeMeta(t: string | null) {
  return TYPE_META[t ?? ''] ?? TYPE_META['agent'];
}

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

type SessionStatus = 'pinned' | 'active' | 'stale' | 'draft';

function sessionStatus(s: Session): SessionStatus {
  if (s.pinned) return 'pinned';
  if (isDraft(s)) return 'draft';
  const daysSince = (Date.now() - new Date(s.updated_at).getTime()) / 86400000;
  if (daysSince > 7) return 'stale';
  return 'active';
}

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Older';

function dateGroup(iso: string): DateGroup {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return 'This Week';
  if (d < 30) return 'This Month';
  return 'Older';
}

const DATE_GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

const GOLD = '#FDB515';
const NAV = '#0D1B2A';

/** Shared column widths — keep header and rows in sync */
const COL = { type: 72, model: 80, ctx: 48, msgs: 48, user: 130, created: 72, lastUsed: 120 } as const;
const META_GAP = 14;
const ROW_HEIGHT = 68;
const GROUP_HEIGHT = 34;

const MODEL_LABELS: Record<string, { short: string; color: string }> = {
  // Keys matching AVAILABLE_MODELS (workbench/types.ts) — these are stored in progress.last_model
  'opus-4-6':          { short: 'Opus 4.6',    color: '#c4b5fd' },
  'sonnet-4-6':        { short: 'Sonnet 4.6',  color: '#93C5FD' },
  'haiku-4-5':         { short: 'Haiku 4.5',   color: '#6ee7b7' },
  'mistral-l3':        { short: 'Mistral L3',  color: '#a5b4fc' },
  'qwen3-32b':         { short: 'Qwen3',       color: '#67e8f9' },
  'gpt-5-4':           { short: 'GPT-5.4',     color: '#6BC5B0' },
  'grok-4-3':          { short: 'Grok 4.3',    color: '#E8A838' },
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
  return MODEL_LABELS[key] ?? { short: key, color: '#8892A4' };
}

type VirtualItem =
  | { kind: 'group'; label: DateGroup }
  | { kind: 'session'; session: Session };

export default function ChatHistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');
  const [hideDrafts, setHideDrafts] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('history-hide-drafts');
    return stored === null ? true : stored === 'true';
  });
  const [pinning, setPinning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dark = useIsDark();
  const BORDER = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,50,98,0.10)';
  const MUTED = dark ? '#8892A4' : '#5A6A7A';
  const BG = dark ? 'rgba(255,255,255,0.05)' : '#F5F2EB';
  const INPUT_COLOR = dark ? '#c8d4e3' : '#0D1B2A';
  const LIST_BG = dark ? 'rgba(255,255,255,0.02)' : '#FAFAF7';
  const HEADER_BG = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,50,98,0.04)';
  const H1_COLOR = dark ? '#e8eef5' : '#0D1B2A';
  const GROUP_BG = dark ? 'rgba(13,27,42,0.9)' : 'rgba(250,250,247,0.95)';

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/agent-lab/workbench/sessions')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then(data => { setSessions(data.sessions ?? []); setLoading(false); })
      .catch(() => { setError('Could not load history. Please try again.'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const toggleHideDrafts = () => {
    setHideDrafts(prev => {
      const next = !prev;
      localStorage.setItem('history-hide-drafts', String(next));
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = [...sessions];
    if (typeFilter === 'drafts') {
      list = list.filter(s => isDraft(s));
    } else {
      if (hideDrafts) list = list.filter(s => !isDraft(s));
      if (typeFilter !== 'all') list = list.filter(s => (s.artifact_type ?? 'agent') === typeFilter);
    }
    // Surface filter: null surface → treat as 'workbench' (pre-Inspector sessions)
    if (surfaceFilter === 'inspector') {
      list = list.filter(s => s.surface === 'inspector');
    } else if (surfaceFilter === 'workbench') {
      list = list.filter(s => s.surface !== 'inspector');
    }
    if (query.trim()) {
      list = list.filter(s => matchesGlob(query, s.title, s.last_message));
    }
    switch (sort) {
      case 'oldest':   list.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)); break;
      case 'pinned':   list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); break;
      case 'messages': list.sort((a, b) => (b.message_count ?? 0) - (a.message_count ?? 0)); break;
      default:         list.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)); break;
    }
    return list;
  }, [sessions, query, sort, typeFilter, surfaceFilter, hideDrafts]);

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
    const result: VirtualItem[] = [];
    for (const g of DATE_GROUP_ORDER) {
      const sessions = groups.get(g);
      if (sessions && sessions.length > 0) {
        result.push({ kind: 'group', label: g });
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
  const someSelected = selected.size > 0;

  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map(s => s.id)));
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
    if (res.ok) setSessions(prev => prev.filter(s => s.id !== id));
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

  const FILTERS: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'agent', label: 'Agent' },
    { key: 'tool', label: 'Tool' },
    { key: 'schema', label: 'Schema' },
    { key: 'prompt', label: 'Prompt' },
    { key: 'drafts', label: 'Drafts' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Page header */}
      <div style={{ padding: '24px 32px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: "'Source Serif 4', serif", fontSize: 26, fontWeight: 700, color: H1_COLOR, margin: 0, lineHeight: 1.2 }}>
              Chat History
            </h1>
            <p style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13, color: MUTED, marginTop: 5, marginBottom: 0 }}>
              Browse and resume your past Agent Lab conversations.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {draftCount > 0 && (
              <button onClick={toggleHideDrafts} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 7,
                background: hideDrafts ? 'rgba(253,181,21,0.08)' : 'rgba(253,181,21,0.18)',
                border: '1px solid rgba(253,181,21,0.25)', color: GOLD, fontSize: 11, fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace", cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.04em',
              }}>
                {hideDrafts ? 'SHOW DRAFTS' : 'HIDE DRAFTS'}
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, background: 'rgba(253,181,21,0.2)', borderRadius: 3, padding: '1px 5px' }}>
                  {draftCount}
                </span>
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
                borderRadius: 7, background: 'transparent', border: `1px solid ${BORDER}`,
                color: MUTED, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
              }}
            >
              <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
            </button>
            <button
              onClick={() => router.push('/agent-lab/workbench')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 7,
                background: GOLD, border: 'none', color: NAV, fontSize: 13, fontWeight: 600,
                fontFamily: "'Inter Tight', sans-serif", cursor: 'pointer',
              }}
            >
              <Plus size={13} /> New Chat
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0, flexWrap: 'wrap', paddingBottom: 12, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 140 }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED, pointerEvents: 'none' }} />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search  (use * for wildcards)"
              style={{
                width: '100%', paddingLeft: 30, paddingRight: query ? 28 : 10, paddingTop: 7, paddingBottom: 7,
                background: BG, border: `1px solid ${BORDER}`,
                borderRadius: 7, color: INPUT_COLOR, fontSize: 12, fontFamily: "'Inter Tight', sans-serif",
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: MUTED, display: 'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', background: BG, borderRadius: 7, border: `1px solid ${BORDER}`, padding: '2px' }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)} style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.05em', cursor: 'pointer', border: 'none',
                background: typeFilter === f.key ? 'rgba(253,181,21,0.18)' : 'transparent',
                color: typeFilter === f.key ? GOLD : MUTED, transition: 'all 0.12s',
              }}>
                {f.label.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Surface filter pills */}
          <div style={{ display: 'flex', alignItems: 'center', background: BG, borderRadius: 7, border: `1px solid ${BORDER}`, padding: '2px' }}>
            {(['all', 'workbench', 'inspector'] as SurfaceFilter[]).map(sf => (
              <button key={sf} onClick={() => setSurfaceFilter(sf)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.05em', cursor: 'pointer', border: 'none',
                background: surfaceFilter === sf ? 'rgba(253,181,21,0.18)' : 'transparent',
                color: surfaceFilter === sf ? GOLD : MUTED, transition: 'all 0.12s',
                whiteSpace: 'nowrap',
              }}>
                {sf === 'workbench' && <Layers size={9} />}
                {sf === 'inspector' && <Database size={9} />}
                {sf.toUpperCase()}
              </button>
            ))}
          </div>

          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={{
            padding: '6px 10px', borderRadius: 7, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
            background: BG, border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer', outline: 'none',
          }}>
            <option value="recent">Recent first</option>
            <option value="oldest">Oldest first</option>
            <option value="pinned">Pinned first</option>
            <option value="messages">Most messages</option>
          </select>
        </div>

        {/* Column headers */}
        {!loading && !error && filtered.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: META_GAP,
            padding: '8px 16px',
            background: HEADER_BG,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: allVisibleSelected ? GOLD : MUTED, display: 'flex', alignItems: 'center', flexShrink: 0, width: 28 }}>
              {allVisibleSelected ? <CheckSquare size={13} /> : <Square size={13} />}
            </button>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0', minWidth: 0, maxWidth: 'min(520px, 50%)' }}>
              {someSelected ? (
                <>
                  <span style={{ color: GOLD }}>{selected.size} SELECTED</span>
                  {!bulkConfirm && (
                    <button onClick={() => setBulkConfirm(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif" }}>
                      <Trash2 size={10} /> Delete {selected.size}
                    </button>
                  )}
                  {bulkConfirm && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: '#fca5a5', fontSize: 10 }}>Confirm delete?</span>
                      <button onClick={handleBulkDelete} disabled={bulkDeleting} style={{ padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif", display: 'flex', alignItems: 'center', gap: 3 }}>
                        {bulkDeleting ? <><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Deleting</> : 'Yes, delete'}
                      </button>
                      <button onClick={() => setBulkConfirm(false)} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif" }}>Cancel</button>
                    </span>
                  )}
                  <button onClick={() => { setSelected(new Set()); setBulkConfirm(false); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: MUTED, display: 'flex', alignItems: 'center' }}><X size={11} /></button>
                </>
              ) : (
                <span>{filtered.length} SESSION{filtered.length !== 1 ? 'S' : ''}</span>
              )}
            </span>
            <div style={{ flex: 1, minWidth: 16 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: META_GAP, flexShrink: 0 }}>
              <span style={{ width: COL.type, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>TYPE</span>
              <span style={{ width: COL.model, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>MODEL</span>
              <span style={{ width: COL.ctx, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>CTX</span>
              <span style={{ width: COL.msgs, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em', textAlign: 'right' }}>MSGS</span>
              <span style={{ width: COL.user, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em' }}>USER</span>
              <span style={{ width: COL.created, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em', textAlign: 'right' }}>CREATED</span>
              <span style={{ minWidth: COL.lastUsed, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.08em', textAlign: 'right' }}>LAST USED</span>
            </div>
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        onScroll={() => setShowScrollTop((scrollRef.current?.scrollTop ?? 0) > 300)}
        style={{
          flex: 1, overflowY: 'auto', position: 'relative',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(253,181,21,0.35) transparent',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '80px 0', color: MUTED, justifyContent: 'center' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>Loading history…</span>
          </div>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '60px 0', color: '#f87171', justifyContent: 'center' }}>
            <AlertCircle size={16} />
            <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13 }}>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState query={query} onNewChat={() => router.push('/agent-lab/workbench')} MUTED={MUTED} dark={dark} />
        ) : (
          <div style={{ background: LIST_BG, position: 'relative', height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map(vItem => {
              const item = virtualItems[vItem.index];
              if (!item) return null;
              if (item.kind === 'group') {
                return (
                  <div key={vItem.key} style={{
                    position: 'absolute', top: vItem.start, left: 0, right: 0, height: vItem.size,
                    display: 'flex', alignItems: 'center', padding: '0 16px',
                    background: GROUP_BG,
                    borderBottom: `1px solid ${BORDER}`,
                    backdropFilter: 'blur(4px)',
                    zIndex: 2,
                  }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: dark ? '#6b7d94' : '#4A5A6A', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                      {item.label}
                    </span>
                  </div>
                );
              }
              const s = item.session;
              const isLast = vItem.index === virtualItems.length - 1 || virtualItems[vItem.index + 1]?.kind === 'group';
              return (
                <div key={vItem.key} style={{ position: 'absolute', top: vItem.start, left: 0, right: 0, height: vItem.size }}>
                  <SessionRow
                    session={s}
                    isLast={isLast}
                    isSelected={selected.has(s.id)}
                    isPinning={pinning === s.id}
                    onToggleSelect={() => toggleSelect(s.id)}
                    onContinue={() => router.push(s.surface === 'inspector' ? `/inspector/${s.id}` : `/agent-lab/workbench/${s.id}`)}
                    onPin={() => handlePin(s)}
                    onDelete={() => handleSingleDelete(s.id)}
                    onRename={(title) => handleRename(s.id, title)}
                    dark={dark}
                    BORDER={BORDER}
                    MUTED={MUTED}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll to top */}
      {showScrollTop && (
        <button
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            position: 'fixed', bottom: 28, right: 32, width: 36, height: 36, borderRadius: '50%',
            background: GOLD, border: 'none', color: NAV, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 50,
          }}
          title="Scroll to top"
        >
          <ArrowUp size={16} />
        </button>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .history-row:hover { background: ${dark ? 'rgba(253,181,21,0.04)' : 'rgba(0,50,98,0.03)'} !important; }
        .history-row:hover .row-actions { opacity: 1 !important; }
        .row-actions { opacity: 0; transition: opacity 0.15s; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar { width: 5px; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-track { background: transparent; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb { background: rgba(253,181,21,0.3); border-radius: 4px; }
        div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb:hover { background: rgba(253,181,21,0.5); }
      `}</style>
    </div>
  );
}

function EmptyState({ query, onNewChat, MUTED, dark }: { query: string; onNewChat: () => void; MUTED: string; dark: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 24px' }}>
      <MessageSquare size={36} style={{ margin: '0 auto 14px', color: MUTED, display: 'block', opacity: 0.5 }} />
      {query ? (
        <>
          <p style={{ fontFamily: "'Source Serif 4', serif", fontSize: 16, color: MUTED, fontWeight: 600, margin: '0 0 6px' }}>
            No sessions match
          </p>
          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: MUTED, margin: 0 }}>
            &ldquo;{query}&rdquo;
          </p>
        </>
      ) : (
        <>
          <p style={{ fontFamily: "'Source Serif 4', serif", fontSize: 18, color: MUTED, fontWeight: 600, margin: '0 0 8px' }}>No chat history yet</p>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 20px', fontFamily: "'Inter Tight', sans-serif" }}>Start a conversation in the Agent Workbench.</p>
          <button onClick={onNewChat} style={{ padding: '9px 22px', borderRadius: 8, background: GOLD, border: 'none', color: NAV, fontSize: 13, fontWeight: 600, fontFamily: "'Inter Tight', sans-serif", cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Start first chat
          </button>
        </>
      )}
    </div>
  );
}

interface RowProps {
  session: Session;
  isLast: boolean;
  isSelected: boolean;
  isPinning: boolean;
  onToggleSelect: () => void;
  onContinue: () => void;
  onPin: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  dark: boolean;
  BORDER: string;
  MUTED: string;
}

const STATUS_META: Record<SessionStatus, { label: string; color: string; bg: string }> = {
  pinned: { label: 'PINNED', color: GOLD,      bg: 'rgba(253,181,21,0.10)' },
  active: { label: 'ACTIVE', color: '#86EFAC', bg: 'rgba(134,239,172,0.08)' },
  stale:  { label: 'STALE',  color: '#8892A4', bg: 'rgba(136,146,164,0.08)' },
  draft:  { label: 'DRAFT',  color: '#FDB515', bg: 'rgba(253,181,21,0.06)' },
};

function SessionRow({ session, isLast, isSelected, isPinning, onToggleSelect, onContinue, onPin, onDelete, onRename, dark, BORDER, MUTED }: RowProps) {
  const meta = typeMeta(session.artifact_type);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  const TITLE_COLOR = dark ? '#e0e8f2' : '#0D1B2A';
  const PREVIEW_COLOR = dark ? '#7a8fa8' : '#4A5A6A';
  const META_COLOR = dark ? '#6b7d94' : '#5A6A7A';
  const model = modelLabel(session.progress?.last_model as string | undefined);

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

  const displayTitle = session.title || 'Untitled session';

  return (
    <div
      className="history-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: META_GAP,
        padding: '8px 16px',
        minHeight: ROW_HEIGHT,
        borderBottom: isLast ? 'none' : `1px solid ${BORDER}`,
        background: isSelected ? 'rgba(253,181,21,0.04)' : 'transparent',
        transition: 'background 0.1s',
        boxSizing: 'border-box',
      }}
    >
      {/* Checkbox */}
      <button onClick={onToggleSelect} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isSelected ? GOLD : MUTED, display: 'flex', alignItems: 'center', flexShrink: 0, width: 28 }}>
        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
      </button>

      {/* Title + preview */}
      <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 'min(520px, 50%)', cursor: editing ? 'default' : 'pointer' }} onClick={editing ? undefined : onContinue}>
        {editing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitEdit}
              style={{
                flex: 1, background: dark ? 'rgba(255,255,255,0.07)' : '#E4DFCF', border: `1px solid ${GOLD}`,
                borderRadius: 5, padding: '3px 8px', color: dark ? '#e8eef5' : '#0D1B2A', fontSize: 13,
                fontFamily: "'Inter Tight', sans-serif", fontWeight: 600, outline: 'none',
              }}
            />
            <button onClick={commitEdit} style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#86EFAC', display: 'flex' }}><Check size={12} /></button>
            <button onClick={() => { setEditing(false); setEditValue(session.title ?? ''); }} style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: MUTED, display: 'flex' }}><X size={12} /></button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', lineHeight: 1.35 }}>
            {session.pinned && <span style={{ color: GOLD, fontSize: 10, flexShrink: 0 }}>★</span>}
            {session.surface === 'inspector'
              ? <Database size={11} style={{ color: GOLD, flexShrink: 0, opacity: 0.85 }} />
              : <Layers size={11} style={{ color: MUTED, flexShrink: 0, opacity: 0.7 }} />}
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: 3, flexShrink: 0,
              ...(session.surface === 'inspector'
                ? { background: 'rgba(253,181,21,0.12)', color: GOLD, border: '1px solid rgba(253,181,21,0.3)' }
                : { background: '#003262', color: GOLD }),
            }}>
              {session.surface === 'inspector' ? 'INSPECTOR' : 'WORKBENCH'}
            </span>
            <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13, fontWeight: 600, color: TITLE_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayTitle}
            </span>
            {session.saved_agent_id && (
              <span style={{ fontSize: 9, letterSpacing: '0.06em', fontFamily: "'IBM Plex Mono', monospace", color: '#86EFAC', background: 'rgba(134,239,172,0.08)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>DEPLOYED</span>
            )}
          </div>
        )}
        {!editing && (
          <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 12, color: PREVIEW_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3, lineHeight: 1.35 }}>
            {session.last_message || <span style={{ color: META_COLOR, fontStyle: 'italic' }}>No messages yet</span>}
          </div>
        )}
      </div>

      {/* Flexible spacer — absorbs extra width so metadata stays grouped */}
      <div style={{ flex: 1, minWidth: 16 }} />

      {/* Metadata columns */}
      <div style={{ display: 'flex', alignItems: 'center', gap: META_GAP, flexShrink: 0 }}>
        {/* Type badge */}
        <div style={{ width: COL.type, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', fontFamily: "'IBM Plex Mono', monospace", color: meta.color, background: meta.bg, padding: '3px 7px', borderRadius: 3 }}>
            {meta.label}
          </span>
        </div>

        {/* Model badge */}
        <div style={{ width: COL.model, display: 'flex', alignItems: 'center' }}>
          {model ? (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', color: model.color, background: `${model.color}18`, border: `1px solid ${model.color}28`, padding: '3px 7px', borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: COL.model }}>
              {model.short}
            </span>
          ) : (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR }}>—</span>
          )}
        </div>

        {/* Context mode badge */}
        <div style={{ width: COL.ctx, display: 'flex', alignItems: 'center' }}>
          {session.surface === 'inspector' ? (
            <span
              title={session.context_mode === 'warehouse_only' ? 'SQL Only — no catalog context used' : 'Catalog + SQL — harvested context (T0/T1/T2) was used'}
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '3px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                ...(session.context_mode === 'warehouse_only'
                  ? { background: 'rgba(147,197,253,0.12)', color: '#93C5FD', border: '1px solid rgba(147,197,253,0.25)' }
                  : { background: 'rgba(253,181,21,0.10)', color: '#FDB515', border: '1px solid rgba(253,181,21,0.25)' }),
              }}
            >
              {session.context_mode === 'warehouse_only' ? 'SQL' : 'CTX'}
            </span>
          ) : (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR }}>—</span>
          )}
        </div>

        {/* Message count */}
        <div style={{ width: COL.msgs, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {(session.message_count ?? 0) > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MessageSquare size={10} style={{ color: META_COLOR }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: META_COLOR }}>{session.message_count}</span>
            </div>
          ) : (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR }}>—</span>
          )}
        </div>

        {/* User */}
        <div style={{ width: COL.user, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
          {session.user_name || session.user_email ? (
            <>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(253,181,21,0.15)', border: '1px solid rgba(253,181,21,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <User size={9} style={{ color: '#FDB515' }} />
              </div>
              <span title={session.user_email ?? undefined} style={{
                fontFamily: "'Inter Tight', sans-serif", fontSize: 11, color: META_COLOR,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {session.user_name ?? session.user_email}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR }}>—</span>
          )}
        </div>

        {/* Created date */}
        <div style={{ width: COL.created, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR, whiteSpace: 'nowrap' }}>
            {shortDate(session.created_at)}
          </span>
        </div>

        {/* Last used + actions */}
        <div style={{ minWidth: COL.lastUsed, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: META_COLOR, whiteSpace: 'nowrap' }}>
            {relativeTime(session.updated_at)}
          </span>
          <div className="row-actions" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {confirmDelete ? (
              <>
                <button onClick={() => { setConfirmDelete(false); onDelete(); }} style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif" }}>Yes</button>
                <button onClick={() => setConfirmDelete(false)} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif" }}>No</button>
              </>
            ) : (
              <>
                <button onClick={onContinue} title="Open" style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: 'rgba(253,181,21,0.10)', border: '1px solid rgba(253,181,21,0.25)', color: GOLD, cursor: 'pointer', fontFamily: "'Inter Tight', sans-serif", whiteSpace: 'nowrap' }}>
                  <ChevronRight size={11} /> Open
                </button>
                <button onClick={startEdit} title="Rename" style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer' }}>
                  <Pencil size={10} />
                </button>
                <button onClick={onPin} disabled={isPinning} title={session.pinned ? 'Unpin' : 'Pin'} style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${session.pinned ? 'rgba(253,181,21,0.35)' : BORDER}`, color: session.pinned ? GOLD : MUTED, cursor: 'pointer' }}>
                  {isPinning ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : session.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                </button>
                <button onClick={() => setConfirmDelete(true)} title="Delete" style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer' }}>
                  <Trash2 size={10} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
