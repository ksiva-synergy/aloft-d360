'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Share2, Lock, Building2, Users, UserPlus, Trash2, ChevronDown, Check, Link2 } from 'lucide-react';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const SERIF: React.CSSProperties = { fontFamily: "'Source Serif 4', Georgia, serif" };
const SANS: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
const GOLD = '#FDB515';

type Visibility = 'private' | 'org' | 'shared';
type CollabRole = 'editor' | 'viewer';

interface Collaborator {
  id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  granted_by: string;
  created_at: string;
  user?: { id: string; name: string | null; email: string };
}

interface ShareDialogProps {
  dashboardId: string;
  dashboardName: string;
  currentVisibility: Visibility;
  myRole: string | null;
  onClose: () => void;
  onVisibilityChange?: (v: Visibility) => void;
}

export function ShareDialog({
  dashboardId,
  dashboardName,
  currentVisibility,
  myRole,
  onClose,
  onVisibilityChange,
}: ShareDialogProps) {
  const [visibility, setVisibility] = useState<Visibility>(currentVisibility);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollabRole>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const canShare = myRole === 'owner' || myRole === 'editor';

  const loadCollaborators = useCallback(() => {
    fetch(`/api/inspector/dashboards/${dashboardId}/collaborators`)
      .then((r) => r.ok ? r.json() as Promise<{ collaborators: Collaborator[] }> : Promise.reject(new Error(`${r.status}`)))
      .then((data) => setCollaborators(data.collaborators ?? []))
      .catch(() => {/* non-critical */})
      .finally(() => setLoading(false));
  }, [dashboardId]);

  useEffect(() => { loadCollaborators(); }, [loadCollaborators]);

  const handleVisibilityChange = async (v: Visibility) => {
    setVisibility(v);
    setSavingVisibility(true);
    try {
      await fetch(`/api/inspector/dashboards/${dashboardId}/share`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: v }),
      });
      onVisibilityChange?.(v);
    } catch { /* non-critical */ }
    finally { setSavingVisibility(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const resp = await fetch(`/api/inspector/dashboards/${dashboardId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        throw new Error(data.error ?? `Failed: ${resp.status}`);
      }
      setInviteEmail('');
      loadCollaborators();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await fetch(`/api/inspector/dashboards/${dashboardId}/collaborators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
    } catch { /* non-critical */ }
  };

  const handleRoleChange = async (userId: string, role: CollabRole, email: string) => {
    try {
      await fetch(`/api/inspector/dashboards/${dashboardId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      setCollaborators((prev) => prev.map((c) => c.user_id === userId ? { ...c, role } : c));
    } catch { /* non-critical */ }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/inspector/dashboards/${dashboardId}/builder`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const VISIBILITY_OPTIONS: { value: Visibility; icon: React.ReactNode; label: string; desc: string }[] = [
    { value: 'private', icon: <Lock size={13} />, label: 'Private', desc: 'Only collaborators with access' },
    { value: 'org', icon: <Building2 size={13} />, label: 'Org', desc: 'Anyone in the organisation can view' },
    { value: 'shared', icon: <Users size={13} />, label: 'Shared', desc: 'Visible to invited collaborators' },
  ];

  return (
    <div
      ref={overlayRef}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div style={{ background: 'var(--bg-surface, #0D1B2A)', border: '1px solid var(--border-default)', borderRadius: 6, width: 480, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <Share2 size={15} style={{ color: GOLD }} />
          <div style={{ flex: 1 }}>
            <p style={{ ...SERIF, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Share Dashboard</p>
            <p style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 0', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{dashboardName}</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Visibility */}
          <section>
            <p style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px' }}>
              ACCESS LEVEL {savingVisibility && <span style={{ color: GOLD, marginLeft: 8 }}>SAVING…</span>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {VISIBILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => canShare && handleVisibilityChange(opt.value)}
                  disabled={!canShare}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 4,
                    background: visibility === opt.value ? 'rgba(253,181,21,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${visibility === opt.value ? 'rgba(253,181,21,0.4)' : 'var(--border-default)'}`,
                    cursor: canShare ? 'pointer' : 'default', textAlign: 'left', transition: 'all 0.12s',
                    opacity: !canShare ? 0.6 : 1,
                  }}
                >
                  <span style={{ color: visibility === opt.value ? GOLD : 'var(--text-muted)', flexShrink: 0 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ ...SANS, fontSize: 13, fontWeight: 500, color: visibility === opt.value ? GOLD : 'var(--text-primary)', margin: 0 }}>{opt.label}</p>
                    <p style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 0', letterSpacing: '0.02em' }}>{opt.desc}</p>
                  </div>
                  {visibility === opt.value && <Check size={13} style={{ color: GOLD, flexShrink: 0 }} />}
                </button>
              ))}
            </div>
          </section>

          {/* Invite people */}
          {canShare && (
            <section>
              <p style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px' }}>INVITE PEOPLE</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder="Email address…"
                  style={{ ...SANS, flex: 1, fontSize: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${inviteError ? 'rgba(239,68,68,0.5)' : 'var(--border-default)'}`, borderRadius: 4, color: 'var(--text-primary)', padding: '8px 10px', outline: 'none' }}
                />
                <RoleSelect value={inviteRole} onChange={setInviteRole} />
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  style={{ ...MONO, fontSize: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: GOLD, color: '#0D1B2A', border: 'none', borderRadius: 4, cursor: inviting || !inviteEmail.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, letterSpacing: '0.04em', whiteSpace: 'nowrap', opacity: (!inviteEmail.trim() || inviting) ? 0.5 : 1, flexShrink: 0, textTransform: 'uppercase' }}
                >
                  <UserPlus size={12} />{inviting ? '…' : 'Invite'}
                </button>
              </div>
              {inviteError && (
                <p style={{ ...MONO, fontSize: 10, color: '#F87171', margin: '6px 0 0' }}>{inviteError}</p>
              )}
            </section>
          )}

          {/* Collaborators list */}
          <section>
            <p style={{ ...MONO, fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 10px' }}>
              WHO HAS ACCESS {!loading && `· ${collaborators.length} PEOPLE`}
            </p>
            {loading ? (
              <p style={{ ...MONO, fontSize: 10, color: 'var(--text-muted)' }}>LOADING…</p>
            ) : collaborators.length === 0 ? (
              <p style={{ ...MONO, fontSize: 10, color: 'var(--text-muted)' }}>No explicit collaborators yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {collaborators.map((c) => {
                  const displayName = c.user ? (c.user.name ?? c.user.email.split('@')[0]) : c.user_id.slice(0, 12);
                  const email = c.user?.email ?? '';
                  const isOwner = c.role === 'owner';
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {/* Avatar */}
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(253,181,21,0.15)', border: '1px solid rgba(253,181,21,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ ...MONO, fontSize: 10, fontWeight: 700, color: GOLD }}>{displayName[0]?.toUpperCase()}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ ...SANS, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</p>
                        {email && <p style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</p>}
                      </div>
                      {isOwner ? (
                        <span style={{ ...MONO, fontSize: 9, color: GOLD, background: 'rgba(253,181,21,0.1)', border: '1px solid rgba(253,181,21,0.25)', borderRadius: 3, padding: '2px 6px', letterSpacing: '0.05em', flexShrink: 0 }}>OWNER</span>
                      ) : canShare ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <RoleSelect value={c.role as CollabRole} onChange={(r) => handleRoleChange(c.user_id, r, email)} small />
                          <button onClick={() => handleRemove(c.user_id)} style={{ background: 'transparent', border: 'none', color: '#8892A4', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center', borderRadius: 3 }} title="Remove">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <span style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>{c.role}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-default)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handleCopyLink}
            style={{ ...MONO, fontSize: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, color: copied ? '#34D399' : 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            <Link2 size={12} />{copied ? 'COPIED!' : 'COPY LINK'}
          </button>
          <button
            onClick={onClose}
            style={{ ...MONO, fontSize: 10, padding: '7px 16px', background: GOLD, color: '#0D1B2A', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RoleSelect ─────────────────────────────────────────────────────────────────

function RoleSelect({ value, onChange, small }: { value: CollabRole; onChange: (r: CollabRole) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const ROLES: { value: CollabRole; label: string }[] = [
    { value: 'editor', label: 'Editor' },
    { value: 'viewer', label: 'Viewer' },
  ];
  const selected = ROLES.find((r) => r.value === value);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...MONO, fontSize: small ? 9 : 10, display: 'flex', alignItems: 'center', gap: 4, padding: small ? '4px 8px' : '7px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {selected?.label}<ChevronDown size={10} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bg-surface, #0D1B2A)', border: '1px solid var(--border-default)', borderRadius: 4, minWidth: 100, zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => { onChange(r.value); setOpen(false); }}
              style={{ ...MONO, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '7px 10px', background: value === r.value ? 'rgba(253,181,21,0.08)' : 'transparent', border: 'none', color: value === r.value ? GOLD : 'var(--text-primary)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              {r.label}{value === r.value && <Check size={10} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
