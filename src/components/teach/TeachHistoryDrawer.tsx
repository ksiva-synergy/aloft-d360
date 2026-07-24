'use client';

/**
 * TeachHistoryDrawer — the Teach-native session history (Track A, A4).
 *
 * Lists this user's persisted Teach sessions from the shared list endpoint,
 * filtered to ?surface=teach, and surfaces each session's topic + counters.
 * Opening one navigates to /agent-lab/teach/[id] (a real navigation → the
 * [sessionId] server component → hydrate). Dedicated (not the Inspector
 * HistoryDrawer) so it wears the app's own light/dark theme tokens like the rest
 * of the Teach surface, and only ever shows teach sessions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Clock, Plus, Trash2, Loader2, MessageSquare } from 'lucide-react';
import { FONT_BODY, FONT_MONO } from './teach-tokens';

interface TeachSessionRow {
  id: string;
  title: string | null;
  message_count: number | null;
  last_message: string | null;
  updated_at: string;
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

export function TeachHistoryDrawer({
  open,
  onClose,
  currentSessionId,
}: {
  open: boolean;
  onClose: () => void;
  currentSessionId: string | null;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<TeachSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/agent-lab/workbench/sessions?surface=teach')
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((data: { sessions?: TeachSessionRow[] }) => setSessions(data.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const openSession = (id: string) => {
    onClose();
    router.push(`/agent-lab/teach/${id}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/agent-lab/workbench/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', zIndex: 40 }}
      />
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, zIndex: 50,
          background: 'var(--card)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', fontFamily: FONT_BODY,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={13} color="var(--primary)" />
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.1em', color: 'var(--primary)', textTransform: 'uppercase' }}>
              Teach History
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted-foreground)', cursor: 'pointer' }}
          >
            <X size={13} />
          </button>
        </div>

        {/* New session */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            onClick={() => { onClose(); router.push('/agent-lab/teach'); }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
              color: 'var(--primary)', fontSize: 12, fontWeight: 500,
            }}
          >
            <Plus size={13} /> New Teach Session
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 40, gap: 8, color: 'var(--muted-foreground)' }}>
              <Loader2 size={14} style={{ animation: 'tm-spin 1s linear infinite' }} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 11 }}>Loading…</span>
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: 'var(--muted-foreground)' }}>
              <MessageSquare size={26} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
              <p style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em' }}>No teaching sessions yet.</p>
            </div>
          ) : (
            sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  style={{
                    position: 'relative', borderRadius: 8, marginBottom: 2, cursor: 'pointer',
                    padding: '9px 36px 9px 10px', transition: 'background 0.12s',
                    border: isCurrent ? '1px solid color-mix(in srgb, var(--primary) 35%, transparent)' : '1px solid transparent',
                    background: isCurrent ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'var(--muted)'; }}
                  onMouseLeave={(e) => { if (!isCurrent) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', padding: '1px 4px', borderRadius: 2 }}>
                      TEACH
                    </span>
                    {isCurrent && (
                      <span style={{ fontFamily: FONT_MONO, fontSize: 8, color: 'var(--success)', letterSpacing: '0.06em' }}>ACTIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.title || 'Untitled teaching session'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: 'var(--text-tertiary)' }}>{relativeTime(s.updated_at)}</span>
                    {(s.message_count ?? 0) > 0 && (
                      <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: 'var(--text-tertiary)' }}>
                        · {s.message_count} msg{(s.message_count ?? 0) !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, s.id)}
                    disabled={deleting === s.id}
                    title="Delete"
                    style={{ position: 'absolute', top: 7, right: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', opacity: 0.7 }}
                  >
                    {deleting === s.id ? <Loader2 size={10} style={{ animation: 'tm-spin 1s linear infinite' }} /> : <Trash2 size={10} />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style>{`@keyframes tm-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

export default TeachHistoryDrawer;
