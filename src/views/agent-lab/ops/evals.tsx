'use client';

import React, { useEffect, useState } from 'react';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

export default function AgentOpsEvalsPage() {
  const [suites, setSuites] = useState<{ id: string; name: string | null; _count?: { cases: number } }[]>([]);
  const [runs, setRuns] = useState<{ id: string; status: string | null; suite?: { name: string | null } }[]>([]);

  useEffect(() => {
    fetch('/api/agent-lab/ops/evals')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setSuites(d.suites ?? []);
        setRuns(d.runs ?? []);
      })
      .catch(() => {});
  }, []);

  const queueRun = async (suiteId: string) => {
    await fetch('/api/agent-lab/ops/evals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suiteId }),
    });
    const d = await fetch('/api/agent-lab/ops/evals').then((r) => r.json());
    setRuns(d.runs ?? []);
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ ...mono, fontSize: 14, letterSpacing: '0.1em', color: 'var(--brand-a)' }}>EVAL SUITES</h1>
      <p style={{ ...mono, fontSize: 11, color: 'var(--ink-3)' }}>Queued runs execute via Boost / Performance Lab pipeline.</p>
      <section style={{ marginTop: 20 }}>
        {suites.map((s) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', ...mono, fontSize: 12, padding: '8px 0' }}>
            <span>{s.name ?? s.id} ({s._count?.cases ?? 0} cases)</span>
            <button type="button" onClick={() => queueRun(s.id)} style={{ fontSize: 10 }}>Queue run</button>
          </div>
        ))}
      </section>
      <h2 style={{ ...mono, fontSize: 12, marginTop: 32, color: 'var(--ink-3)' }}>Recent runs</h2>
      {runs.map((r) => (
        <div key={r.id} style={{ ...mono, fontSize: 11, padding: '4px 0' }}>
          {r.suite?.name ?? 'suite'} — {r.status}
        </div>
      ))}
    </div>
  );
}
