'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
  Terminal,
  Copy,
  Check,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { ToolCall } from '@/components/agent-lab/workbench/types';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const serif: React.CSSProperties = { fontFamily: "'Source Serif 4', Georgia, serif" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

const GOLD = '#FDB515';
const MUTED = 'var(--wb-muted)';
const INK = 'var(--wb-ink)';
const INK_DIM = 'var(--wb-ink-dim)';
const SURFACE = 'var(--wb-surface)';
const SURFACE2 = 'var(--wb-surface2)';
const BORDER_SUBTLE = 'var(--wb-border-subtle)';
const BORDER_GOLD = 'rgba(253,181,21,0.30)';
const VIOLET = '#8b5cf6';
const VIOLET_BG = 'rgba(139,92,246,0.06)';
const VIOLET_BORDER = 'rgba(139,92,246,0.22)';
const GREEN = '#22c55e';
const RED = '#ef4444';

// ── Readiness badge ────────────────────────────────────────────────────────────
const READINESS_META: Record<string, { label: string; color: string; bg: string }> = {
  interview: { label: 'INTERVIEW', color: '#93C5FD', bg: 'rgba(30,58,95,0.7)' },
  plan:      { label: 'PLAN',      color: GOLD,      bg: 'rgba(63,42,0,0.7)' },
  build:     { label: 'BUILD',     color: '#86EFAC', bg: 'rgba(22,101,52,0.7)' },
};

function ReadinessBadge({ value }: { value: 'interview' | 'plan' | 'build' }) {
  const meta = READINESS_META[value];
  if (!meta) return null;
  return (
    <span style={{
      ...mono,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.14em',
      color: meta.color,
      background: meta.bg,
      border: `1px solid ${meta.color}30`,
      borderRadius: 4,
      padding: '2px 7px',
    }}>
      {meta.label}
    </span>
  );
}

// ── Thinking accordion ─────────────────────────────────────────────────────────
function ThinkingAccordion({
  thinking,
  isStreaming,
}: {
  thinking: string;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lineCount = thinking.trim().split('\n').length;
  const wordCount = thinking.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div style={{
      marginBottom: 10,
      borderRadius: 8,
      border: `1px solid ${VIOLET_BORDER}`,
      background: VIOLET_BG,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {isStreaming ? (
          <Loader2
            size={13}
            style={{ color: VIOLET, animation: 'spin 1s linear infinite', flexShrink: 0 }}
          />
        ) : open ? (
          <ChevronDown size={13} style={{ color: VIOLET, flexShrink: 0 }} />
        ) : (
          <ChevronRight size={13} style={{ color: VIOLET, flexShrink: 0 }} />
        )}
        <span style={{ ...mono, fontSize: 11, color: VIOLET, fontWeight: 500 }}>
          {isStreaming ? 'Reasoning…' : 'Thought process'}
        </span>
        {!isStreaming && (
          <span style={{ ...mono, fontSize: 10, color: MUTED, marginLeft: 'auto' }}>
            {wordCount} words · {lineCount} lines
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="thinking-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              borderTop: `1px solid ${VIOLET_BORDER}`,
              padding: '12px 14px 14px',
              borderLeft: `3px solid ${VIOLET}40`,
              marginLeft: 14,
            }}>
              <pre style={{
                ...mono,
                fontSize: 11,
                color: MUTED,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.65,
                margin: 0,
                maxHeight: 280,
                overflowY: 'auto',
              }}>
                {thinking}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Tool call cards ────────────────────────────────────────────────────────────
function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);

  const statusIcon = tc.status === 'running'
    ? <Loader2 size={12} style={{ color: GOLD, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
    : tc.status === 'success'
    ? <CheckCircle size={12} style={{ color: GREEN, flexShrink: 0 }} />
    : tc.status === 'error'
    ? <XCircle size={12} style={{ color: RED, flexShrink: 0 }} />
    : <Terminal size={12} style={{ color: MUTED, flexShrink: 0 }} />;

  const borderColor = tc.status === 'running'
    ? 'rgba(253,181,21,0.25)'
    : tc.status === 'success'
    ? 'rgba(34,197,94,0.2)'
    : tc.status === 'error'
    ? 'rgba(239,68,68,0.2)'
    : BORDER_SUBTLE;

  const formatOutput = (val: unknown): string => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  };

  return (
    <div style={{
      borderRadius: 6,
      border: `1px solid ${borderColor}`,
      background: SURFACE,
      overflow: 'hidden',
      marginBottom: 4,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {statusIcon}
        <span style={{ ...mono, fontSize: 11, color: INK_DIM, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tc.toolName || tc.toolId}
        </span>
        {tc.durationMs != null && tc.status === 'success' && (
          <span style={{ ...mono, fontSize: 10, color: MUTED, flexShrink: 0 }}>
            {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {open
          ? <ChevronDown size={11} style={{ color: MUTED, flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: MUTED, flexShrink: 0 }} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tool-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: `1px solid ${BORDER_SUBTLE}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tc.input !== undefined && (
                <div>
                  <div style={{ ...mono, fontSize: 9, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Input</div>
                  <pre style={{ ...mono, fontSize: 11, color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto', margin: 0, background: SURFACE2, padding: '6px 10px', borderRadius: 4 }}>
                    {typeof tc.input === 'object' ? JSON.stringify(tc.input, null, 2) : String(tc.input)}
                  </pre>
                </div>
              )}
              {tc.output !== undefined && (
                <div>
                  <div style={{ ...mono, fontSize: 9, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Output</div>
                  <pre style={{ ...mono, fontSize: 11, color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', margin: 0, background: SURFACE2, padding: '6px 10px', borderRadius: 4 }}>
                    {formatOutput(tc.output)}
                  </pre>
                </div>
              )}
              {tc.error && (
                <div style={{ ...mono, fontSize: 11, color: RED, background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 4 }}>
                  {tc.error}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolCallsSection({ toolCalls, isStreaming }: { toolCalls: ToolCall[]; isStreaming: boolean }) {
  const [open, setOpen] = useState(true);
  const runningCount = toolCalls.filter(t => t.status === 'running' || t.status === 'suggested').length;
  const successCount = toolCalls.filter(t => t.status === 'success').length;
  const errorCount = toolCalls.filter(t => t.status === 'error').length;
  const totalDuration = toolCalls.reduce((s, t) => s + (t.durationMs || 0), 0);
  const names = [...new Set(toolCalls.map(t => (t.toolName || t.toolId).replace(/^Databricks:\s*/i, '')))].join(', ');

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          background: SURFACE,
          border: `1px solid ${BORDER_SUBTLE}`,
          borderRadius: 6,
          cursor: 'pointer',
          textAlign: 'left',
          marginBottom: open ? 4 : 0,
        }}
      >
        {runningCount > 0
          ? <Loader2 size={12} style={{ color: GOLD, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          : errorCount > 0
          ? <XCircle size={12} style={{ color: RED, flexShrink: 0 }} />
          : <CheckCircle size={12} style={{ color: GREEN, flexShrink: 0 }} />}
        <span style={{ ...sans, fontSize: 11, color: INK_DIM, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isStreaming && runningCount > 0
            ? `Using ${names}…`
            : `${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''} — ${names}`}
        </span>
        {!isStreaming && totalDuration > 0 && (
          <span style={{ ...mono, fontSize: 10, color: MUTED, flexShrink: 0 }}>
            {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{ ...mono, fontSize: 9, color: RED, background: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
            {errorCount} failed
          </span>
        )}
        {open
          ? <ChevronDown size={11} style={{ color: MUTED, flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: MUTED, flexShrink: 0 }} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tool-calls-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingLeft: 12, borderLeft: `2px solid ${BORDER_GOLD}` }}>
              {toolCalls.map((tc) => (
                <ToolCallCard key={tc.callId} tc={tc} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const tokenRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>);
    if (m[2] != null) parts.push(<strong key={m.index} style={{ fontWeight: 600, color: INK }}>{m[2]}</strong>);
    else if (m[3] != null) parts.push(<em key={m.index}>{m[3]}</em>);
    else if (m[4] != null) parts.push(
      <code key={m.index} style={{ ...mono, fontSize: 12, background: 'rgba(253,181,21,0.10)', color: GOLD, padding: '1px 5px', borderRadius: 3 }}>
        {m[4]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);
  return parts;
}

function MarkdownLine({ line }: { line: string }) {
  const isH1 = /^#\s+/.test(line);
  const isH2 = /^##\s+/.test(line);
  const isH3 = /^###\s+/.test(line);
  const isH4 = /^####\s+/.test(line);
  const isBullet = /^[-*]\s+/.test(line);
  const isNumbered = /^\d+\.\s+/.test(line);
  const isHr = /^---+$/.test(line.trim());
  const isBlockquote = /^>\s+/.test(line);

  if (isHr) return <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: '12px 0' }} />;

  const raw = isH1 ? line.replace(/^#\s+/, '')
    : isH2 ? line.replace(/^##\s+/, '')
    : isH3 ? line.replace(/^###\s+/, '')
    : isH4 ? line.replace(/^####\s+/, '')
    : isBullet ? line.replace(/^[-*]\s+/, '')
    : isNumbered ? line.replace(/^\d+\.\s+/, '')
    : isBlockquote ? line.replace(/^>\s+/, '')
    : line;

  const inline = renderInline(raw);

  if (isH1) return <div style={{ ...serif, fontSize: 17, fontWeight: 700, color: INK, marginTop: 14, marginBottom: 4 }}>{inline}</div>;
  if (isH2) return <div style={{ ...serif, fontSize: 15, fontWeight: 600, color: INK, marginTop: 12, marginBottom: 3 }}>{inline}</div>;
  if (isH3) return <div style={{ ...sans, fontSize: 13, fontWeight: 600, color: INK_DIM, marginTop: 10, marginBottom: 2 }}>{inline}</div>;
  if (isH4) return <div style={{ ...sans, fontSize: 12, fontWeight: 600, color: MUTED, marginTop: 8, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{inline}</div>;
  if (isBullet) return (
    <div style={{ display: 'flex', gap: 8, marginLeft: 6, marginTop: 2, marginBottom: 2 }}>
      <span style={{ color: GOLD, fontSize: 10, flexShrink: 0, marginTop: 4 }}>▸</span>
      <span>{inline}</span>
    </div>
  );
  if (isNumbered) {
    const num = /^(\d+)\./.exec(line)?.[1] ?? '1';
    return (
      <div style={{ display: 'flex', gap: 8, marginLeft: 6, marginTop: 2, marginBottom: 2 }}>
        <span style={{ ...mono, color: GOLD, fontSize: 10, flexShrink: 0, minWidth: 16, textAlign: 'right' }}>{num}.</span>
        <span>{inline}</span>
      </div>
    );
  }
  if (isBlockquote) return (
    <div style={{ borderLeft: `3px solid ${BORDER_GOLD}`, paddingLeft: 12, color: MUTED, fontStyle: 'italic', margin: '4px 0' }}>
      {inline}
    </div>
  );
  if (line === '') return <div style={{ height: 8 }} />;
  return <div>{inline}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy code"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        ...mono,
        fontSize: 10,
        color: copied ? GREEN : MUTED,
        padding: '2px 6px',
        borderRadius: 4,
        transition: 'color 0.2s',
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AssistantContent({ content }: { content: string }) {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const prose = content.slice(lastIndex, match.index);
      parts.push(
        <div key={`p-${lastIndex}`} style={{ ...serif, fontSize: 14, lineHeight: 1.7, color: INK }}>
          {prose.split('\n').map((ln, i) => <MarkdownLine key={i} line={ln} />)}
        </div>,
      );
    }
    const lang = match[1] || 'text';
    const code = match[2];
    parts.push(
      <div key={`c-${match.index}`} style={{ margin: '10px 0', borderRadius: 6, overflow: 'hidden', border: `1px solid ${BORDER_GOLD}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: SURFACE2 }}>
          <span style={{ ...mono, fontSize: 10, color: MUTED }}>{lang}</span>
          <CopyButton text={code} />
        </div>
        <pre style={{ margin: 0, padding: '12px 14px', ...mono, fontSize: 12.5, background: SURFACE2, color: INK, overflowX: 'auto', lineHeight: 1.6 }}>
          {code}
        </pre>
      </div>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    parts.push(
      <div key={`p-${lastIndex}`} style={{ ...serif, fontSize: 14, lineHeight: 1.7, color: INK }}>
        {remaining.split('\n').map((ln, i) => <MarkdownLine key={i} line={ln} />)}
      </div>,
    );
  }

  return <>{parts.length > 0 ? parts : <div style={{ ...serif, fontSize: 14, lineHeight: 1.7, color: INK }}>{content.split('\n').map((ln, i) => <MarkdownLine key={i} line={ln} />)}</div>}</>;
}

// ── Streaming pulse indicator ─────────────────────────────────────────────────
function StreamPulse() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
    }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: GOLD,
            animation: `sm-dot-pulse 1.4s ease-in-out ${i * 0.22}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ── Main StreamingMessage component ───────────────────────────────────────────
export interface StreamingMessageProps {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  isStreaming: boolean;
  /** True when the stream was stopped by the user (shows an interrupted badge). */
  interrupted?: boolean;
  readiness?: 'interview' | 'plan' | 'build' | null;
  timestamp?: number;
  /** Total streaming duration in milliseconds (shown in footer after completion). */
  durationMs?: number;
  /** Total tokens used (shown in footer after completion). */
  tokenCount?: number;
  /** Model identifier used for this message (shown in footer). */
  modelName?: string;
}

export function StreamingMessage({
  content,
  thinking,
  toolCalls,
  isStreaming,
  interrupted = false,
  readiness,
  timestamp,
  durationMs,
  tokenCount,
  modelName,
}: StreamingMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const isThinkingOnly = !content && thinking && isStreaming;
  const ts = timestamp
    ? new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const shortModel = modelName
    ? modelName.replace(/^(anthropic\.|amazon\.|openai\.)/i, '').replace(/-\d{8}$/, '')
    : null;

  return (
    <>
      {/* Thinking accordion */}
      {thinking && (
        <ThinkingAccordion
          thinking={thinking}
          isStreaming={isStreaming && !content}
        />
      )}

      {/* Tool calls */}
      {toolCalls && toolCalls.length > 0 && (
        <ToolCallsSection toolCalls={toolCalls} isStreaming={isStreaming} />
      )}


      {/* Main content card */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{
          background: SURFACE,
          borderRadius: 8,
          border: `1px solid ${BORDER_SUBTLE}`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Streaming top bar */}
        {isStreaming && (
          <div style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            animation: 'sm-progress-slide 1.6s ease-in-out infinite',
          }} />
        )}

        <div style={{ padding: '16px 20px' }}>
          {content ? (
            <AssistantContent content={content} />
          ) : isThinkingOnly ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StreamPulse />
              <span style={{ ...mono, fontSize: 11, color: MUTED }}>reasoning…</span>
            </div>
          ) : isStreaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={13} style={{ color: GOLD }} />
              <StreamPulse />
            </div>
          ) : null}
        </div>

        {/* Footer: readiness badge + timestamp + tokens + duration + model + copy */}
        {(!isStreaming || readiness || ts) && (content || interrupted) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 16px 10px',
            borderTop: `1px solid ${BORDER_SUBTLE}`,
            flexWrap: 'wrap',
            gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {readiness && <ReadinessBadge value={readiness} />}
              {interrupted && !isStreaming && (
                <span style={{
                  ...mono, fontSize: 9, color: 'rgba(239,68,68,0.8)',
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)',
                  borderRadius: 4, padding: '2px 7px', letterSpacing: '0.06em',
                }}>STOPPED</span>
              )}
              {ts && <span style={{ ...mono, fontSize: 10, color: MUTED }}>{ts}</span>}
              {!isStreaming && durationMs != null && (
                <span style={{ ...mono, fontSize: 10, color: MUTED }}>
                  {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
              {!isStreaming && tokenCount != null && tokenCount > 0 && (
                <span style={{ ...mono, fontSize: 10, color: MUTED }}>
                  {tokenCount.toLocaleString()} tok
                </span>
              )}
              {!isStreaming && shortModel && (
                <span style={{ ...mono, fontSize: 10, color: 'rgba(74,96,128,0.8)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shortModel}
                </span>
              )}
            </div>
            {!isStreaming && content && (
              <button
                onClick={handleCopyAll}
                title="Copy response"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  ...mono, fontSize: 10, color: copied ? GREEN : MUTED,
                  padding: '2px 0', transition: 'color 0.2s',
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        )}
      </motion.div>

      {/* Keyframes */}
      <style>{`
        @keyframes sm-dot-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
          40%            { opacity: 1;   transform: scale(1.1);  }
        }
        @keyframes sm-progress-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
