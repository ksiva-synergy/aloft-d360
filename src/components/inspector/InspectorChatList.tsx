'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/lib/navigation';
import Link from '@/lib/navigation/link';
import { Check, ChevronsLeft, ChevronsRight, MessageSquare, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import { sessionOpenHref } from '@/lib/sessions/surfaces';

export interface InspectorChatItem {
  id: string;
  title: string | null;
  last_message: string | null;
  pinned: boolean | null;
  surface: string | null;
  updated_at: string;
}

const COLLAPSED_KEY = 'inspector.chatList.collapsed';

function relativeTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const chatLabel = (c: InspectorChatItem) => c.title || c.last_message || 'Untitled session';

export type ChatGroup = { label: string; items: InspectorChatItem[] };

/** Pinned first, then Today / Yesterday / Previous 7 days / Older (by local calendar day). */
export function groupChats(items: InspectorChatItem[], now: Date = new Date()): ChatGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const buckets: ChatGroup[] = [
    { label: 'Pinned', items: [] },
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  const sorted = [...items].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  for (const c of sorted) {
    const t = new Date(c.updated_at).getTime();
    const bucket = c.pinned ? 0 : t >= startOfToday ? 1 : t >= startOfToday - DAY ? 2 : t >= startOfToday - 7 * DAY ? 3 : 4;
    buckets[bucket].items.push(c);
  }
  return buckets.filter((g) => g.items.length > 0);
}

export function filterChats(items: InspectorChatItem[], query: string): InspectorChatItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((c) => `${c.title ?? ''} ${c.last_message ?? ''}`.toLowerCase().includes(q));
}

interface InspectorChatListProps {
  activeId: string | null;
  disabled?: boolean;
  /** Changes whenever the list should be re-fetched (new session, title change, reply finished). */
  refreshKey: string;
  onNew: () => void;
  /** Called after a rename succeeds, so the shell can update the open session's title. */
  onRenamed?: (id: string, title: string) => void;
}

/** Persistent, collapsible chat list for the Inspector (mirrors the Agents chat sidebar). */
export function InspectorChatList({ activeId, disabled = false, refreshKey, onNew, onRenamed }: InspectorChatListProps) {
  const router = useRouter();
  const [chats, setChats] = useState<InspectorChatItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* private mode */ }
      return next;
    });
  };

  const load = useCallback(() => {
    fetch('/api/agent-lab/workbench/sessions?mine=1&surface=inspector')
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data: { sessions?: InspectorChatItem[] }) => setChats(data.sessions ?? []))
      .catch(() => setChats((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (editingId) editInputRef.current?.select();
  }, [editingId]);

  const groups = useMemo(() => groupChats(filterChats(chats ?? [], query)), [chats, query]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/agent-lab/workbench/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  };

  const togglePin = async (c: InspectorChatItem) => {
    if (busyId) return;
    setBusyId(c.id);
    try {
      if (await patch(c.id, { pinned: !c.pinned })) {
        setChats((prev) => prev?.map((x) => (x.id === c.id ? { ...x, pinned: !c.pinned } : x)) ?? prev);
      }
    } finally {
      setBusyId(null);
    }
  };

  const commitRename = async () => {
    const id = editingId;
    const title = editValue.trim();
    setEditingId(null);
    if (!id || !title) return;
    const prev = chats?.find((c) => c.id === id);
    if (prev && title === (prev.title ?? '')) return;
    setChats((list) => list?.map((x) => (x.id === id ? { ...x, title } : x)) ?? list);
    if (await patch(id, { title })) onRenamed?.(id, title);
    else load();
  };

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/agent-lab/workbench/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setChats((prev) => prev?.filter((x) => x.id !== id) ?? prev);
        if (id === activeId) onNew();
      }
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  };

  const iconBtn =
    'inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-3)] hover:bg-[var(--surface-1)] hover:text-[var(--ink-1)] disabled:opacity-40';

  if (collapsed) {
    return (
      <aside className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--line-1)] pt-3 md:flex" aria-label="Chat list (collapsed)">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Show chat list"
          aria-label="Show chat list"
          aria-expanded={false}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] active:scale-[0.95]"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNew}
          title="New session"
          aria-label="New session"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--line-1)] md:flex" aria-label="Your chats">
      <div className="flex items-center justify-between gap-2 pb-2 pl-4 pr-2 pt-3">
        <span className="text-size-ui font-semibold text-[var(--ink-1)]">Chats</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onNew}
            title="New session"
            aria-label="New session"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)]"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Hide chat list"
            aria-label="Hide chat list"
            aria-expanded
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-2)] transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] active:scale-[0.95]"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2.5 focus-within:border-[color-mix(in_srgb,var(--brand-a)_45%,transparent)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-size-ui text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {chats === null ? (
          <div className="space-y-1 px-2 py-2" aria-busy="true" aria-label="Loading chats">
            {[78, 62, 86, 54, 70].map((w, i) => (
              <span key={w} className="ld-skel block" style={{ width: `${w}%`, height: 12, margin: '10px 0', animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        ) : chats.length === 0 ? (
          <p className="px-2 py-3 text-size-ui leading-relaxed text-[var(--ink-3)]">
            No sessions yet. Your Ask Data conversations are saved here and only you can see them.
          </p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-size-ui text-[var(--ink-3)]">No chats match “{query.trim()}”.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-2" aria-label={g.label}>
              <h3 className="px-2 pb-1 pt-2 text-[length:var(--type-caption-size)] font-medium text-[var(--ink-3)]">{g.label}</h3>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === activeId;
                  const editing = editingId === c.id;
                  const confirming = confirmDeleteId === c.id;
                  return (
                    <li key={c.id} className="group relative">
                      {editing ? (
                        <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-2)] px-2 py-1.5">
                          <input
                            ref={editInputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            onBlur={() => void commitRename()}
                            aria-label="Session title"
                            maxLength={200}
                            className="min-w-0 flex-1 rounded-md border border-[var(--line-1)] bg-[var(--surface-1)] px-2 py-1 text-size-ui text-[var(--ink-1)] outline-none"
                          />
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => router.push(sessionOpenHref(c))}
                            disabled={disabled && !active}
                            aria-current={active ? 'true' : undefined}
                            className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 pr-2 text-left transition-colors disabled:opacity-50 group-hover:pr-[84px] group-focus-within:pr-[84px] ${
                              confirming ? 'pr-[84px] ' : ''
                            }${active ? 'bg-[var(--surface-2)] text-[var(--ink-1)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'}`}
                          >
                            {c.pinned
                              ? <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-a)]" />
                              : <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-size-ui font-medium">{chatLabel(c)}</span>
                              <span className="block truncate text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
                                {relativeTime(c.updated_at)}
                              </span>
                            </span>
                          </button>
                          <div
                            className={`absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 ${
                              confirming ? 'flex' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                            }`}
                          >
                            {confirming ? (
                              <>
                                <button type="button" className={`${iconBtn} !text-[var(--err,#ef4444)]`} onClick={() => void remove(c.id)} disabled={busyId === c.id} title="Confirm delete" aria-label={`Confirm delete ${chatLabel(c)}`}>
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" className={iconBtn} onClick={() => setConfirmDeleteId(null)} title="Cancel" aria-label="Cancel delete">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" className={iconBtn} onClick={() => void togglePin(c)} disabled={busyId === c.id} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={`${c.pinned ? 'Unpin' : 'Pin'} ${chatLabel(c)}`}>
                                  {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  className={iconBtn}
                                  onClick={() => { setEditValue(c.title || ''); setEditingId(c.id); }}
                                  title="Rename"
                                  aria-label={`Rename ${chatLabel(c)}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" className={iconBtn} onClick={() => setConfirmDeleteId(c.id)} disabled={busyId === c.id || (disabled && active)} title="Delete" aria-label={`Delete ${chatLabel(c)}`}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="border-t border-[var(--line-1)] px-4 py-2">
        <Link href="/agent-lab/history" className="text-[length:var(--type-caption-size)] text-[var(--ink-3)] hover:text-[var(--ink-1)]">
          All history →
        </Link>
      </div>
    </aside>
  );
}
