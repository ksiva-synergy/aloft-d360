'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { useBuilderStore } from './builder-store';
import { computeVersionDiff, type VersionDiffSummary } from './version-diff';
import type { WidgetSpec } from '@/lib/dashboards/types';

const MONO: React.CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
};

interface VersionEntry {
  id: string;
  version_number: number;
  created_by: string;
  created_at: string;
  change_summary: string | null;
  widgets?: WidgetSpec[];
}

interface VersionHistoryPanelProps {
  dashboardId: string;
}

export function VersionHistoryPanel({ dashboardId }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Map<string, VersionDiffSummary>>(new Map());

  const setDashboard = useBuilderStore((s) => s.setDashboard);
  const loadWidgets = useBuilderStore((s) => s.loadWidgets);

  const loadVersions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/inspector/dashboards/${dashboardId}/versions`);
      if (!res.ok) throw new Error(`Failed to load versions: ${res.status}`);
      const data = await res.json();
      const versionList: VersionEntry[] = data.versions ?? [];
      setVersions(versionList);
      setCurrentVersionId(data.currentVersionId ?? null);

      // Compute diffs between consecutive versions (need widget data)
      await computeDiffsForVersions(dashboardId, versionList, setDiffs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handleRestore = async (versionId: string) => {
    setRestoring(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/inspector/dashboards/${dashboardId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown' }));
        throw new Error(data.error ?? `Restore failed: ${res.status}`);
      }

      // State-sync: refetch dashboard to get restored version's widgets
      const dashRes = await fetch(`/api/inspector/dashboards/${dashboardId}`);
      if (!dashRes.ok) throw new Error('Failed to reload dashboard after restore');
      const dashData = await dashRes.json();
      const { dashboard, currentVersion } = dashData;

      setDashboard(dashboard.id, dashboard.model_id, dashboard.name, dashboard.current_version_id);
      if (currentVersion?.widgets) {
        loadWidgets(currentVersion.widgets as WidgetSpec[]);
      } else {
        loadWidgets([]);
      }

      // Update local version list state
      setCurrentVersionId(versionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)' }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
      {error && (
        <div style={{ ...MONO, fontSize: 10, color: '#F87171', padding: '6px 0', marginBottom: 4 }}>
          {error}
        </div>
      )}

      {versions.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <span style={{ ...MONO, fontSize: 10, color: 'var(--builder-text-muted)' }}>
            No saved versions yet
          </span>
        </div>
      )}

      {versions.map((v) => {
        const isCurrent = v.id === currentVersionId;
        const date = new Date(v.created_at);
        const diff = diffs.get(v.id);
        return (
          <div
            key={v.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 6px',
              borderBottom: '1px solid var(--builder-border)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...MONO, fontSize: 10, color: 'var(--builder-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>v{v.version_number}</span>
                {isCurrent && (
                  <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: 'rgba(134,239,172,0.1)', color: '#86EFAC', border: '1px solid rgba(134,239,172,0.2)' }}>
                    CURRENT
                  </span>
                )}
              </div>
              <div style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-muted)', marginTop: 2 }}>
                {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              {v.change_summary && (
                <div style={{ ...MONO, fontSize: 9, color: 'var(--builder-text-label)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.change_summary}
                </div>
              )}
              {diff && (diff.added > 0 || diff.removed > 0 || diff.modified > 0) && (
                <div
                  style={{ ...MONO, fontSize: 8, color: 'var(--builder-text-muted)', marginTop: 3, display: 'flex', gap: 6 }}
                  title={`${diff.added} added, ${diff.removed} removed, ${diff.modified} modified`}
                >
                  {diff.added > 0 && <span style={{ color: '#86EFAC' }}>+{diff.added}</span>}
                  {diff.removed > 0 && <span style={{ color: '#F87171' }}>−{diff.removed}</span>}
                  {diff.modified > 0 && <span style={{ color: '#FDB515' }}>~{diff.modified}</span>}
                </div>
              )}
            </div>
            {!isCurrent && (
              <button
                onClick={() => handleRestore(v.id)}
                disabled={restoring !== null}
                title="Restore this version"
                style={{
                  ...MONO,
                  fontSize: 9,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '4px 8px',
                  borderRadius: 3,
                  border: '1px solid var(--builder-border)',
                  background: 'transparent',
                  color: 'var(--builder-text-muted)',
                  cursor: restoring ? 'default' : 'pointer',
                  opacity: restoring === v.id ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                <RotateCcw size={10} />
                {restoring === v.id ? '…' : 'RESTORE'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Fetches widget data for each version pair and computes diffs.
 * Versions come in desc order (newest first). We compare each version
 * against the one immediately before it (older = next in array).
 */
async function computeDiffsForVersions(
  dashboardId: string,
  versions: VersionEntry[],
  setDiffs: React.Dispatch<React.SetStateAction<Map<string, VersionDiffSummary>>>,
) {
  if (versions.length < 2) return;

  try {
    // Fetch full version data with widgets for diff computation
    const res = await fetch(`/api/inspector/dashboards/${dashboardId}/versions?includeWidgets=true`);
    if (!res.ok) return;
    const data = await res.json();
    const fullVersions: VersionEntry[] = data.versions ?? [];

    if (fullVersions.length < 2) return;

    const diffMap = new Map<string, VersionDiffSummary>();

    // Versions are in desc order (newest first)
    for (let i = 0; i < fullVersions.length - 1; i++) {
      const newer = fullVersions[i];
      const older = fullVersions[i + 1];
      if (newer.widgets && older.widgets) {
        const diff = computeVersionDiff(
          { widgets: older.widgets },
          { widgets: newer.widgets },
        );
        diffMap.set(newer.id, diff);
      }
    }

    setDiffs(diffMap);
  } catch {
    // Non-critical — diffs are informational only
  }
}
