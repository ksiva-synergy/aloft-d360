'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, Clock, FileText, Pin, PinOff, Trash2, ExternalLink, Loader2, Layers, Database } from 'lucide-react';

interface Session {
  id: string;
  title: string | null;
  artifact_type: string | null;
  message_count: number | null;
  last_message: string | null;
  pinned: boolean | null;
  surface: string | null;
  updated_at: string;
  created_at: string;
  query_result_count?: number;
}

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  currentSessionId: string | null;
}

const GOLD = '#FDB515';
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

function typeLabel(type: string | null): { label: string; color: string } {
  switch (type) {
    case 'tool': return { label: 'TOOL', color: '#93C5FD' };
    case 'schema': return { label: 'SCHEMA', color: '#86EFAC' };
    case 'prompt': return { label: 'PROMPT', color: '#c4b5fd' };
    case 'bus_contract': return { label: 'BUS', color: '#fdba74' };
    default: return { label: 'AGENT', color: GOLD };
  }
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
  return new Date(iso).toLocaleDateString();
}

export function HistoryDrawer({ open, onClose, currentSessionId }: HistoryDrawerProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/agent-lab/workbench/sessions')
      .then(r => r.json())
      .then(data => { setSessions(data.sessions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/agent-lab/workbench/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) setSessions(prev => prev.filter(s => s.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handlePin = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (pinning) return;
    setPinning(session.id);
    const newPinned = !session.pinned;
    try {
      await fetch(`/api/agent-lab/workbench/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: newPinned }),
      });
      setSessions(prev =>
        [...prev.map(s => s.id === session.id ? { ...s, pinned: newPinned } : s)]
          .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      );
    } finally {
      setPinning(null);
    }
  };

  const handleOpen = (session: Session) => {
    onClose();
    const base = session.surface === 'inspector' ? '/inspector' : '/agent-lab/workbench';
    router.push(`${base}/${session.id}`);
  };

  const handleNewChat = () => {
    onClose();
    router.push('/agent-lab/workbench');
  };

  if (!open) return null;

  const pinned = sessions.filter(s => s.pinned);
  const recent = sessions.filter(s => !s.pinned);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(2px)',
          zIndex: 40,
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 340,
          background: 'var(--wb-surface)',
          borderLeft: '1px solid rgba(253,181,21,0.15)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          ...sans,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--wb-border-subtle)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={14} color={GOLD} />
            <span style={{ ...mono, fontSize: 11, letterSpacing: '0.10em', color: GOLD, textTransform: 'uppercase' }}>
              Chat History
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 5,
              background: 'transparent', border: '1px solid var(--wb-border-subtle)',
              color: 'var(--wb-muted)', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* New Chat button */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--wb-border-subtle)', flexShrink: 0 }}>
          <button
            onClick={handleNewChat}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8,
              background: 'rgba(253,181,21,0.1)', border: '1px solid rgba(253,181,21,0.3)',
              color: GOLD, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Plus size={13} />
            New Agent Chat
          </button>
        </div>

        {/* Sessions list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 8, color: 'var(--wb-muted)' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ ...mono, fontSize: 11 }}>Loading…</span>
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--wb-muted)' }}>
              <FileText size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
              <p style={{ ...mono, fontSize: 11, letterSpacing: '0.04em' }}>No past sessions yet.</p>
              <p style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>Start a new chat to get going.</p>
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <SectionList
                  label="Pinned"
                  items={pinned}
                  currentId={currentSessionId}
                  deleting={deleting}
                  pinning={pinning}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                  onPin={handlePin}
                />
              )}
              {recent.length > 0 && (
                <SectionList
                  label={pinned.length > 0 ? 'Recent' : undefined}
                  items={recent}
                  currentId={currentSessionId}
                  deleting={deleting}
                  pinning={pinning}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                  onPin={handlePin}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--wb-border-subtle)',
          flexShrink: 0,
          display: 'flex', justifyContent: 'center',
        }}>
          <a
            href="/agent-lab/history"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              ...mono, fontSize: 10, letterSpacing: '0.06em', color: 'var(--wb-muted)',
              textDecoration: 'none',
            }}
            onClick={onClose}
          >
            <ExternalLink size={10} />
            VIEW FULL HISTORY
          </a>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

interface SectionListProps {
  label?: string;
  items: Session[];
  currentId: string | null;
  deleting: string | null;
  pinning: string | null;
  onOpen: (session: Session) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onPin: (e: React.MouseEvent, session: Session) => void;
}

function SectionList({ label, items, currentId, deleting, pinning, onOpen, onDelete, onPin }: SectionListProps) {
  const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
  const GOLD = '#FDB515';

  return (
    <div style={{ marginBottom: 4 }}>
      {label && (
        <div style={{
          ...mono, fontSize: 9, letterSpacing: '0.10em', color: 'var(--wb-muted)',
          textTransform: 'uppercase', padding: '8px 10px 4px',
        }}>
          {label}
        </div>
      )}
      {items.map(s => {
        const isCurrent = s.id === currentId;
        const badge = typeLabel(s.artifact_type);
        return (
          <div
            key={s.id}
            style={{
              position: 'relative',
              borderRadius: 8,
              border: isCurrent
                ? '1px solid rgba(253,181,21,0.35)'
                : '1px solid transparent',
              background: isCurrent
                ? 'rgba(253,181,21,0.05)'
                : 'transparent',
              marginBottom: 2,
              transition: 'all 0.12s',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'var(--wb-border-subtle)';
            }}
            onMouseLeave={e => {
              if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <button
              onClick={() => onOpen(s)}
              style={{
                width: '100%', textAlign: 'left',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '9px 36px 9px 10px',
              }}
            >
              {/* Title row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {/* Surface icon + badge */}
                {s.surface === 'inspector'
                  ? <Database size={9} style={{ color: GOLD, flexShrink: 0 }} />
                  : <Layers size={9} style={{ color: '#3a5070', flexShrink: 0 }} />}
                <span style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', ...mono,
                  ...(s.surface === 'inspector'
                    ? { color: GOLD, background: 'rgba(253,181,21,0.1)', padding: '1px 4px', borderRadius: 2, border: '1px solid rgba(253,181,21,0.25)' }
                    : { color: GOLD, background: '#003262', padding: '1px 4px', borderRadius: 2 }),
                }}>
                  {s.surface === 'inspector' ? 'INSP' : 'WB'}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
                  color: badge.color, ...mono, opacity: 0.8,
                }}>
                  {badge.label}
                </span>
                {s.pinned && <span style={{ fontSize: 8, color: GOLD, ...mono }}>★</span>}
                {isCurrent && (
                  <span style={{ fontSize: 8, color: '#86EFAC', ...mono, letterSpacing: '0.06em' }}>ACTIVE</span>
                )}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 500, color: '#c8d4e3',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontFamily: "'Inter Tight', system-ui, sans-serif",
              }}>
                {s.title || 'Untitled session'}
              </div>
              {s.last_message && (
                <div style={{
                  fontSize: 11, color: '#4a6080', marginTop: 2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: "'Inter Tight', system-ui, sans-serif",
                }}>
                  {s.last_message}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ ...mono, fontSize: 9, color: '#3a5070', letterSpacing: '0.04em' }}>
                  {relativeTime(s.updated_at)}
                </span>
                {(s.message_count ?? 0) > 0 && (
                  <span style={{ ...mono, fontSize: 9, color: '#3a5070' }}>
                    · {s.message_count} msg{(s.message_count ?? 0) !== 1 ? 's' : ''}
                  </span>
                )}
                {s.surface === 'inspector' && (s.query_result_count ?? 0) > 0 && (
                  <span style={{ ...mono, fontSize: 9, color: GOLD, opacity: 0.7 }}>
                    · {s.query_result_count} quer{(s.query_result_count ?? 0) !== 1 ? 'ies' : 'y'}
                  </span>
                )}
              </div>
            </button>

            {/* Action buttons (top-right) */}
            <div style={{
              position: 'absolute', top: 7, right: 7,
              display: 'flex', gap: 2,
            }}>
              <button
                onClick={e => onPin(e, s)}
                disabled={pinning === s.id}
                title={s.pinned ? 'Unpin' : 'Pin'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 4,
                  background: 'transparent', border: 'none',
                  color: s.pinned ? GOLD : '#3a5070', cursor: 'pointer', opacity: 0.7,
                }}
              >
                {s.pinned ? <PinOff size={10} /> : <Pin size={10} />}
              </button>
              <button
                onClick={e => onDelete(e, s.id)}
                disabled={deleting === s.id}
                title="Delete"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 4,
                  background: 'transparent', border: 'none',
                  color: '#3a5070', cursor: 'pointer', opacity: 0.7,
                }}
              >
                {deleting === s.id ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={10} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
