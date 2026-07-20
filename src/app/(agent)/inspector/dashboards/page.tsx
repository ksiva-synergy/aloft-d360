'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Plus, BarChart2, Calendar, User, Search,
  Lock, Building2, Users, MoreHorizontal, Share2, Copy, Trash2, Eye,
} from 'lucide-react';

const MONO: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const SERIF: React.CSSProperties = { fontFamily: "'Source Serif 4', Georgia, serif" };
const SANS: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };
const GOLD = '#FDB515';

type DashboardVisibility = 'private' | 'org' | 'shared';
type FilterTab = 'all' | 'mine' | 'shared';

interface DashboardOwner {
  id: string;
  name: string | null;
  email: string;
}

interface DashboardSummary {
  id: string;
  name: string;
  description: string | null;
  model_id: string;
  created_by: string;
  visibility: DashboardVisibility;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
  widget_count: number;
  collaborator_count: number;
  owner: DashboardOwner | null;
  my_role: string | null;
}

export default function DashboardsListPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadDashboards = useCallback((tab: FilterTab) => {
    setLoading(true);
    setError(null);
    fetch(`/api/inspector/dashboards?filter=${tab}`)
      .then((r) => r.ok ? r.json() as Promise<{ dashboards: DashboardSummary[] }> : Promise.reject(new Error(`${r.status}`)))
      .then((data) => setDashboards(data.dashboards ?? []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load dashboards'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadDashboards(filter); }, [filter, loadDashboards]);

  const handleNewDashboard = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const name = window.prompt('Dashboard name');
      if (!name?.trim()) { setCreating(false); return; }

      const resp = await fetch('/api/inspector/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), visibility: 'org' }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error ?? `Create failed: ${resp.status}`);
      }
      const data = await resp.json() as { dashboard: { id: string } };
      router.push(`/inspector/dashboards/${data.dashboard.id}/builder`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dashboard');
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const resp = await fetch(`/api/inspector/dashboards/${id}`, { method: 'DELETE' });
      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        throw new Error(data.error ?? `Delete failed: ${resp.status}`);
      }
      setDashboards((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete dashboard');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const filtered = dashboards.filter((d) =>
    search.trim() === '' || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const TABS: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'mine', label: 'My Dashboards' },
    { id: 'shared', label: 'Shared with Me' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 0', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LayoutDashboard size={18} style={{ color: GOLD }} />
            <div>
              <h1 style={{ ...SERIF, fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.2 }}>
                Dashboards
              </h1>
              <p style={{ ...MONO, fontSize: 10, color: 'var(--text-muted)', margin: '3px 0 0', letterSpacing: '0.04em' }}>
                INSPECTOR · SAVED DASHBOARDS
              </p>
            </div>
          </div>
          <button
            onClick={handleNewDashboard}
            disabled={creating}
            style={{
              ...MONO, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase', background: GOLD,
              color: '#0D1B2A', border: 'none', borderRadius: 4, padding: '8px 16px',
              cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.6 : 1, fontWeight: 600,
            }}
          >
            <Plus size={13} />
            {creating ? 'CREATING…' : 'NEW DASHBOARD'}
          </button>
        </div>

        {/* Search + Tabs row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                style={{
                  ...MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                  padding: '8px 14px', background: 'transparent', border: 'none',
                  borderBottom: filter === tab.id ? `2px solid ${GOLD}` : '2px solid transparent',
                  color: filter === tab.id ? GOLD : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative', width: 220 }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dashboards…"
              style={{
                ...MONO, fontSize: 10, width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-default)',
                borderRadius: 4, color: 'var(--text-primary)', padding: '6px 8px 6px 28px',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...MONO, fontSize: 11, color: '#F87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '10px 16px', margin: '12px 28px 0', flexShrink: 0 }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', color: '#F87171', cursor: 'pointer', marginLeft: 12, textDecoration: 'underline', ...MONO, fontSize: 10 }}>dismiss</button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <span style={{ ...MONO, fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>LOADING…</span>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, gap: 12 }}>
            <BarChart2 size={36} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
            <p style={{ ...MONO, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              {search ? 'No dashboards match your search.' : filter === 'mine' ? 'You have not created any dashboards yet.' : filter === 'shared' ? 'No dashboards have been shared with you.' : 'No dashboards yet. Create one to start building visualisations.'}
            </p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {filtered.map((d) => (
              <DashboardCard
                key={d.id}
                dashboard={d}
                onOpen={() => router.push(`/inspector/dashboards/${d.id}/builder`)}
                onShare={() => router.push(`/inspector/dashboards/${d.id}/builder?share=1`)}
                onDelete={() => setDeleteConfirm(d.id)}
                confirmingDelete={deleteConfirm === d.id}
                onConfirmDelete={() => handleDelete(d.id)}
                onCancelDelete={() => setDeleteConfirm(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation overlay */}
      {deleteConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, padding: 24, width: 340, maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ ...SANS, fontSize: 14, color: 'var(--text-primary)', marginBottom: 8, fontWeight: 600 }}>Delete dashboard?</p>
            <p style={{ ...SANS, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>This action cannot be undone. All versions and widget configs will be removed.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ ...MONO, fontSize: 10, padding: '7px 14px', background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ ...MONO, fontSize: 10, padding: '7px 14px', background: '#EF4444', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Visibility Badge ───────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: DashboardVisibility }) {
  const config: Record<DashboardVisibility, { icon: React.ReactNode; label: string; color: string }> = {
    private: { icon: <Lock size={9} />, label: 'PRIVATE', color: '#8892A4' },
    org: { icon: <Building2 size={9} />, label: 'ORG', color: '#60A5FA' },
    shared: { icon: <Users size={9} />, label: 'SHARED', color: '#34D399' },
  };
  const { icon, label, color } = config[visibility] ?? config.org;
  return (
    <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 3, color, background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 3, padding: '2px 5px' }}>
      {icon}{label}
    </span>
  );
}

// ── Role Badge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string | null }) {
  if (!role || role === 'org_member') return null;
  const colors: Record<string, string> = { owner: GOLD, editor: '#A78BFA', viewer: '#8892A4' };
  const color = colors[role] ?? '#8892A4';
  return (
    <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', color, background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 3, padding: '2px 5px', textTransform: 'uppercase' }}>
      {role}
    </span>
  );
}

// ── DashboardCard ─────────────────────────────────────────────────────────────

function DashboardCard({
  dashboard,
  onOpen,
  onShare,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  dashboard: DashboardSummary;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const updatedDate = new Date(dashboard.updated_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const ownerDisplay = dashboard.owner
    ? (dashboard.owner.name ?? dashboard.owner.email.split('@')[0])
    : dashboard.created_by.slice(0, 12);

  const canEdit = dashboard.my_role === 'owner' || dashboard.my_role === 'editor';
  const canDelete = dashboard.my_role === 'owner';

  return (
    <div
      style={{
        position: 'relative',
        background: hovered ? 'rgba(253,181,21,0.04)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hovered ? GOLD : 'rgba(253,181,21,0.15)'}`,
        borderRadius: 6,
        transition: 'all 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
    >
      {/* Clickable area */}
      <button
        onClick={onOpen}
        style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '16px 16px 12px', flex: 1 }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <LayoutDashboard size={14} style={{ color: GOLD, flexShrink: 0, marginTop: 2 }} />
          <span style={{ ...SERIF, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, flex: 1 }}>
            {dashboard.name}
          </span>
        </div>

        {/* Description */}
        {dashboard.description && (
          <p style={{ ...SANS, margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {dashboard.description}
          </p>
        )}

        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <VisibilityBadge visibility={dashboard.visibility} />
          <RoleBadge role={dashboard.my_role} />
          <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: dashboard.widget_count > 0 ? GOLD : 'var(--text-muted)', background: dashboard.widget_count > 0 ? 'rgba(253,181,21,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${dashboard.widget_count > 0 ? 'rgba(253,181,21,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 3, padding: '2px 6px' }}>
            {dashboard.widget_count} {dashboard.widget_count === 1 ? 'WIDGET' : 'WIDGETS'}
          </span>
          {dashboard.collaborator_count > 1 && (
            <span style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Users size={9} />{dashboard.collaborator_count} PEOPLE
            </span>
          )}
        </div>

        {/* Meta footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <User size={9} />{ownerDisplay}
          </span>
          <span style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <Calendar size={9} />{updatedDate}
          </span>
        </div>
      </button>

      {/* Context menu button */}
      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          style={{ background: menuOpen ? 'rgba(255,255,255,0.08)' : 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, borderRadius: 3, display: 'flex', alignItems: 'center', opacity: hovered || menuOpen ? 1 : 0, transition: 'opacity 0.12s' }}
        >
          <MoreHorizontal size={14} />
        </button>

        {menuOpen && (
          <div
            style={{ position: 'absolute', top: 28, right: 0, background: 'var(--bg-surface, #0D1B2A)', border: '1px solid var(--border-default)', borderRadius: 6, minWidth: 160, zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', padding: '4px 0' }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <MenuItem icon={<Eye size={12} />} label="Open" onClick={onOpen} />
            {canEdit && <MenuItem icon={<Share2 size={12} />} label="Share" onClick={onShare} />}
            <MenuItem
              icon={<Copy size={12} />}
              label="Copy link"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/inspector/dashboards/${dashboard.id}/builder`);
                setMenuOpen(false);
              }}
            />
            {canDelete && (
              <>
                <div style={{ borderTop: '1px solid var(--border-default)', margin: '4px 0' }} />
                <MenuItem icon={<Trash2 size={12} />} label="Delete" onClick={() => { setMenuOpen(false); onDelete(); }} danger />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...MONO, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: hov ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 10, letterSpacing: '0.04em', color: danger ? '#F87171' : 'var(--text-primary)', transition: 'background 0.1s' }}
    >
      {icon}{label}
    </button>
  );
}
