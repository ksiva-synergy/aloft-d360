'use client';

/**
 * TeachThread — the center column: session header (or empty state), the Marcus
 * conversation, and the composer.
 *
 * This is where "understands, doesn't do" reads visually: there are NO task
 * buttons, no chart-save / pin actions — the Reflect allowlist forbids them
 * server-side and the UI never offers them. Clarifying questions are just
 * ordinary assistant turns (no special event).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { TeachMessage, TeachCounters } from '@/hooks/useTeachChat';
import { FONT_BODY, FONT_DISPLAY, FONT_MONO } from './teach-tokens';
import { SessionHeader } from './SessionHeader';
import { VerificationChip } from './VerificationChip';
import { MemoryRecallExpander } from './MemoryRecallExpander';
import { ThreadEmptyState } from './states/ThreadEmptyState';

const SUBTAG_COLOR: Record<string, string> = {
  'Follow-up question': 'var(--primary)',
  'Verifying a claim': 'var(--primary)',
  'Recalling memory': 'var(--primary)',
};

export function TeachThread({
  messages,
  counters,
  topic,
  isStreaming,
  onSend,
}: {
  messages: TeachMessage[];
  counters: TeachCounters;
  topic: string | null;
  isStreaming: boolean;
  onSend: (text: string) => void;
}) {
  const hasMessages = messages.length > 0;
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setDraft('');
  };

  return (
    <main
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--background)',
      }}
    >
      {hasMessages && <SessionHeader topic={topic} counters={counters} />}

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {hasMessages ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
              padding: '26px 28px 28px',
              maxWidth: 800,
              width: '100%',
              margin: '0 auto',
            }}
          >
            {messages.map((m) => (m.role === 'user' ? <UserBubble key={m.id} m={m} /> : <MarcusBubble key={m.id} m={m} streaming={isStreaming} />))}
          </div>
        ) : (
          <ThreadEmptyState onPick={(p) => onSend(p)} />
        )}
      </div>

      <Composer value={draft} onChange={setDraft} onSubmit={submit} disabled={isStreaming} />
    </main>
  );
}

function UserBubble({ m }: { m: TeachMessage }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start' }}>
      <div
        style={{
          maxWidth: 560,
          background: 'var(--muted)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '15px 15px 4px 15px',
          padding: '13px 16px',
          fontFamily: FONT_BODY,
          fontSize: 14.5,
          lineHeight: 1.6,
          color: 'var(--foreground)',
        }}
      >
        {m.content}
      </div>
      <div style={avatarUser}>KM</div>
    </div>
  );
}

function MarcusBubble({ m, streaming }: { m: TeachMessage; streaming: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={avatarMarcus}>M</div>
      <div
        style={{
          maxWidth: 600,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '15px 15px 15px 4px',
          padding: '14px 17px',
          boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>
            Marcus
          </span>
          {m.subTag && (
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: SUBTAG_COLOR[m.subTag] ?? 'var(--muted-foreground)' }}>
              · {m.subTag}
            </span>
          )}
        </div>

        {m.content ? (
          <div style={{ fontFamily: FONT_BODY, fontSize: 14.5, lineHeight: 1.62, color: 'var(--foreground)', whiteSpace: 'pre-wrap' }}>
            {m.content}
          </div>
        ) : (
          streaming && <ThinkingDots />
        )}

        {m.verification && <VerificationChip v={m.verification} />}
        {m.recall && m.recall.hits.length > 0 && <MemoryRecallExpander hits={m.recall.hits} />}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--text-tertiary)',
            animation: 'tm-pulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div style={{ padding: '14px 28px 20px', background: 'var(--background)', flexShrink: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '11px 12px 11px 16px',
          borderRadius: 14,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.05)',
          maxWidth: 800,
          margin: '0 auto',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', animation: 'tm-pulse 1.8s ease-in-out infinite', flexShrink: 0 }} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Teach Marcus something about the estate…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: FONT_BODY,
            fontSize: 14,
            color: 'var(--foreground)',
          }}
        />
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 8.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border)',
            padding: '3px 8px',
            borderRadius: 7,
            flexShrink: 0,
          }}
        >
          Reflect
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            boxShadow: '0 4px 14px color-mix(in srgb, var(--primary) 30%, transparent)',
            cursor: disabled || !value.trim() ? 'default' : 'pointer',
            opacity: disabled || !value.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}

const avatarUser: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'var(--muted)',
  border: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: FONT_MONO,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted-foreground)',
  flexShrink: 0,
};

const avatarMarcus: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
  color: 'var(--primary-foreground)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: FONT_DISPLAY,
  fontSize: 15,
  fontWeight: 600,
  boxShadow: '0 4px 14px color-mix(in srgb, var(--primary) 30%, transparent)',
  flexShrink: 0,
};

export default TeachThread;
