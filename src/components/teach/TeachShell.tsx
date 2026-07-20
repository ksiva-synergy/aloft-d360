'use client';

/**
 * TeachShell — the Phase-4 Teach page host.
 *
 * Two regions inside the shared (agent) layout: the center thread and the docked
 * "What Marcus is learning" rail. Owns useTeachChat and wires:
 *   learnings → rail   ·   messages → thread   ·   resolve/verify → hook actions
 *
 * The surface consumes the APP's own light/dark theme tokens (globals.css
 * `:root` / `.dark`) — the same palette as its sibling, the Teach Digest — so it
 * follows the app's global theme toggle. The `.teach-surface` class is just a
 * structural hook (scrollbar); it carries no palette of its own.
 */
import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useTeachChat } from '@/hooks/useTeachChat';
import { FONT_MONO } from './teach-tokens';
import { TeachThread } from './TeachThread';
import { LearningRail } from './LearningRail';

export default function TeachShell() {
  const teach = useTeachChat();

  // Topic = the first thing the user taught, trimmed. Derived, not tracked.
  const firstUser = teach.messages.find((m) => m.role === 'user')?.content ?? null;
  const topic = firstUser ? (firstUser.length > 64 ? `${firstUser.slice(0, 64)}…` : firstUser) : null;

  const onVerify = (learning: { statement: string }) =>
    teach.send(`Please verify against the estate: ${learning.statement}`);

  return (
    <div
      className="teach-surface"
      style={{ height: '100%', display: 'flex', overflow: 'hidden', background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {teach.error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 28px',
              flexShrink: 0,
              background: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
              borderBottom: '1px solid color-mix(in srgb, var(--destructive) 26%, transparent)',
              color: 'var(--destructive)',
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: '0.04em',
            }}
          >
            <AlertTriangle size={12} /> {teach.error}
          </div>
        )}

        <TeachThread
          messages={teach.messages}
          counters={teach.counters}
          topic={topic}
          isStreaming={teach.isStreaming}
          onSend={teach.send}
        />

        {/* Build-seam link — the digest is still the read-only hand-off surface. */}
        <Link
          href="/agent-lab/teach/digest"
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
            zIndex: 20,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 8,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
            color: 'var(--muted-foreground)',
            fontFamily: FONT_MONO,
            fontSize: 8.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          Candidate hand-off <ArrowUpRight size={11} />
        </Link>
      </div>

      <LearningRail
        learnings={teach.learnings}
        order={teach.learningOrder}
        onResolve={teach.resolveLearning}
        onVerify={onVerify}
      />
    </div>
  );
}
