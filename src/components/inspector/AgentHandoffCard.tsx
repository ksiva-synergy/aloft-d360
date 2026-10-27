'use client';

import React, { useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { ArrowRight, Bot, Loader2, X } from 'lucide-react';
import { stashWorkbenchSeed } from '@/lib/construction/handoff';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

/**
 * Shown in Inspector when the user asks to build an agent. Opens Agent Lab with a
 * new draft that already carries the tables this Inspector session confirmed.
 */
export function AgentHandoffCard({
  inspectorSessionId,
  mission,
  onDismiss,
}: {
  inspectorSessionId: string | null;
  mission: string;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent-lab/workbench/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectorSessionId, mission }),
      });
      const data = (await res.json().catch(() => ({}))) as { sessionId?: string; seedMessage?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setError(data.error ?? `Could not open Agent Lab (${res.status})`);
        setBusy(false);
        return;
      }
      stashWorkbenchSeed(data.sessionId, data.seedMessage ?? mission);
      router.push(`/agent-lab/agents/workbench/${data.sessionId}`);
    } catch {
      setError('Could not open Agent Lab. Check your connection and try again.');
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Build this agent in Agent Lab"
      style={{
        margin: '0 16px 10px',
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--brand-a) 40%, transparent)',
        background: 'color-mix(in srgb, var(--brand-a) 8%, var(--wb-surface))',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: 30, height: 30, borderRadius: 8, background: 'var(--brand-a-soft)', color: 'var(--brand-a-ink)',
        }}
      >
        <Bot size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--type-body-size)', fontWeight: 600, color: 'var(--ink-1)' }}>Build this agent in Agent Lab</div>
        <div style={{ fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 2 }}>
          Describe it in plain words there and watch the blueprint fill in: name, instructions, data and tools, all editable.
          Tables you confirmed in this session come with it.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => void open()}
            disabled={busy}
            style={{
              ...mono, fontSize: 'var(--type-caption-size)', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 12px', borderRadius: 6, border: 'none', cursor: busy ? 'default' : 'pointer',
              background: 'var(--brand-a)', color: '#fff', opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
            {busy ? 'Opening…' : 'Open Agent Lab'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--type-caption-size)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}
          >
            Keep exploring data
          </button>
        </div>
        {error && <div role="alert" style={{ fontSize: 'var(--type-caption-size)', color: 'var(--bad)', marginTop: 6 }}>{error}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
