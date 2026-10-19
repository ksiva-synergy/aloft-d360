'use client';

import React, { useEffect, useState } from 'react';
import type { SessionCockpitPayload } from '@/lib/agent-ops/session-cockpit';
import { SessionCockpit } from './SessionCockpit';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

export default function RunDetailPage({ sessionId }: { sessionId: string }) {
  const [title, setTitle] = useState('');
  const [surface, setSurface] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<SessionCockpitPayload | null>(null);
  const [openHref, setOpenHref] = useState(`/inspector/${sessionId}`);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/agent-lab/runs/${sessionId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setTitle(d.session?.title ?? '');
        setSurface(d.session?.surface ?? null);
        setContextMode(d.session?.contextMode ?? null);
        setCockpit(d.cockpit ?? null);
        setOpenHref(d.links?.open ?? `/inspector/${sessionId}`);
        setError(null);
      })
      .catch((e: unknown) => {
        const status = e instanceof Error ? e.message : '';
        setError(
          status === '404' || status === '403'
            ? 'Session not found or access denied.'
            : status === '401'
              ? 'You are signed out. Sign in again and reload.'
              : status === '500'
                ? 'The server hit an error loading this run (500). Check the dev server terminal for the stack trace.'
                : 'Could not load this run. Check your connection and reload.',
        );
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div style={{ ...mono, fontSize: 12, padding: 24, color: 'var(--ink-3)' }}>Loading session intelligence…</div>;
  }

  if (error || !cockpit) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: '#D9774B', ...mono, fontSize: 12 }}>{error ?? 'No data'}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SessionCockpit
        sessionId={sessionId}
        title={title}
        surface={surface}
        contextMode={contextMode}
        cockpit={cockpit}
        openHref={openHref}
      />
    </div>
  );
}
