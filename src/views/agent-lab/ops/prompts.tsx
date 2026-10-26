'use client';

import React, { useEffect, useState } from 'react';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

type PromptRow = { id: string; name: string; category: string | null; template: string | null; description: string | null };

export default function AgentOpsPromptsPage() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');

  const load = () => {
    fetch('/api/agent-lab/ops/prompts')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPrompts(d.prompts ?? []))
      .catch(() => setPrompts([]));
  };

  useEffect(() => { load(); }, []);

  const onCreate = async () => {
    await fetch('/api/agent-lab/ops/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template }),
    });
    setName('');
    setTemplate('');
    load();
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <h1 className="type-title-page" style={{ color: 'var(--ink-1)' }}>Prompt registry</h1>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...mono, fontSize: 'var(--type-caption-size)', padding: 8 }} />
        <textarea placeholder="Template" value={template} onChange={(e) => setTemplate(e.target.value)} rows={6} style={{ ...mono, fontSize: 'var(--type-caption-size)', padding: 8 }} />
        <button type="button" onClick={onCreate} style={{ ...mono, fontSize: 'var(--type-caption-size)', padding: '8px 12px', alignSelf: 'flex-start' }}>Save prompt</button>
      </div>
      <ul style={{ marginTop: 24, listStyle: 'none', padding: 0 }}>
        {prompts.map((p) => (
          <li key={p.id} style={{ ...mono, fontSize: 'var(--type-caption-size)', padding: '10px 0', borderBottom: '1px solid var(--wb-border-subtle)' }}>
            <strong>{p.name}</strong> {p.category && <span style={{ color: 'var(--ink-3)' }}>({p.category})</span>}
            {p.description && <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>{p.description}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
