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
  Zap,
} from 'lucide-react';
import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { CaptainStatus } from '@/components/companion/CaptainStatus';
import type { TurnOpsSnapshot } from '@/components/agent-lab/workbench/types';

import { withAlpha } from '@/lib/theme/with-alpha';
import { type } from '@/lib/typography/tokens';
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const sans: React.CSSProperties = { fontFamily: 'var(--font-sans)' };

const GOLD = 'var(--brand-a-ink)';
const MUTED = 'var(--wb-muted)';
const INK = 'var(--wb-ink)';
const INK_DIM = 'var(--wb-ink-dim)';
const SURFACE = 'var(--wb-surface)';
const SURFACE2 = 'var(--wb-surface2)';
const BORDER_SUBTLE = 'var(--wb-border-subtle)';
const BORDER_GOLD = 'color-mix(in srgb, var(--brand-a) 30%, transparent)';
const VIOLET = '#8b5cf6';
const VIOLET_BG = 'rgba(139,92,246,0.06)';
const VIOLET_BORDER = 'rgba(139,92,246,0.22)';
const GREEN = '#22c55e';
const RED = '#ef4444';

// ── Readiness badge ────────────────────────────────────────────────────────────
const READINESS_META: Record<string, { label: string; color: string; bg: string }> = {
  interview: { label: 'INTERVIEW', color: 'var(--brand-b)', bg: 'color-mix(in srgb, var(--brand-b) 14%, transparent)' },
  plan:      { label: 'PLAN',      color: GOLD,      bg: 'color-mix(in srgb, var(--brand-a) 12%, transparent)' },
  build:     { label: 'BUILD',     color: 'var(--ok)', bg: 'var(--ok-bg)' },
};

function ReadinessBadge({ value }: { value: 'interview' | 'plan' | 'build' }) {
  const meta = READINESS_META[value];
  if (!meta) return null;
  return (
    <span style={{
      ...mono,
      fontSize: 'var(--type-ui-regular-size)',
      fontWeight: 600,
      letterSpacing: '0.08em',
      color: meta.color,
      background: meta.bg,
      border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
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
        <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: VIOLET, fontWeight: 500 }}>
          {isStreaming ? 'Reasoning…' : 'Thought process'}
        </span>
        {!isStreaming && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED, marginLeft: 'auto' }}>
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
              borderLeft: `3px solid ${withAlpha(VIOLET, '40')}`,
              marginLeft: 14,
            }}>
              <pre style={{
                ...mono,
                fontSize: 'var(--type-ui-regular-size)',
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
    ? 'color-mix(in srgb, var(--brand-a) 25%, transparent)'
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
        <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tc.toolName || tc.toolId}
        </span>
        {tc.durationMs != null && tc.status === 'success' && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flexShrink: 0 }}>
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
                  <div style={{ ...type.label, color: MUTED, marginBottom: 4 }}>Input</div>
                  <pre style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto', margin: 0, background: SURFACE2, padding: '6px 10px', borderRadius: 4 }}>
                    {typeof tc.input === 'object' ? JSON.stringify(tc.input, null, 2) : String(tc.input)}
                  </pre>
                </div>
              )}
              {tc.output !== undefined && (
                <div>
                  <div style={{ ...type.label, color: MUTED, marginBottom: 4 }}>Output</div>
                  <pre style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', margin: 0, background: SURFACE2, padding: '6px 10px', borderRadius: 4 }}>
                    {formatOutput(tc.output)}
                  </pre>
                </div>
              )}
              {tc.error && (
                <div style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: RED, background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 4 }}>
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
        <span style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isStreaming && runningCount > 0
            ? `Using ${names}…`
            : `${toolCalls.length} tool call${toolCalls.length !== 1 ? 's' : ''} — ${names}`}
        </span>
        {!isStreaming && totalDuration > 0 && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flexShrink: 0 }}>
            {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: RED, background: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
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
      <code key={m.index} style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', background: 'color-mix(in srgb, var(--brand-a) 10%, transparent)', color: 'var(--brand-a)', padding: '1px 5px', borderRadius: 3 }}>
        {m[4]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);
  return parts;
}

type ColAlign = 'left' | 'center' | 'right';

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')));
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (isTableSeparator(t)) return false;
  return splitTableRow(t).length >= 2;
}

function parseAligns(sepLine: string, colCount: number): ColAlign[] {
  return splitTableRow(sepLine).slice(0, colCount).map((c) => {
    const cell = c.replace(/\s/g, '');
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function MarkdownTable({
  headers,
  aligns,
  rows,
}: {
  headers: string[];
  aligns: ColAlign[];
  rows: string[][];
}) {
  const cellPad: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: `1px solid ${BORDER_SUBTLE}`,
    whiteSpace: 'nowrap',
  };

  return (
    <div
      style={{
        margin: '12px 0 16px',
        borderRadius: 8,
        border: `1px solid ${BORDER_SUBTLE}`,
        overflow: 'hidden',
        background: SURFACE2,
      }}
    >
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            ...sans,
            fontSize: 'var(--type-ui-regular-size)',
            lineHeight: 1.45,
          }}
        >
          <thead>
            <tr style={{ background: 'color-mix(in srgb, var(--brand-a) 8%, transparent)' }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    ...cellPad,
                    ...type.label,
                    color: MUTED,
                    textAlign: aligns[i] ?? 'left',
                    borderBottom: `1px solid ${BORDER_GOLD}`,
                  }}
                >
                  {renderInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--ink-1) 2%, transparent)',
                }}
              >
                {headers.map((_, ci) => {
                  const align = aligns[ci] ?? 'left';
                  const raw = row[ci] ?? '';
                  const numeric = align === 'right' || /^-?\d[\d,]*(\.\d+)?%?$/.test(raw.replace(/,/g, ''));
                  return (
                    <td
                      key={ci}
                      style={{
                        ...cellPad,
                        textAlign: align,
                        color: INK,
                        fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                        ...(numeric ? mono : {}),
                        ...(numeric ? { fontSize: 'var(--type-ui-regular-size)' } : {}),
                        fontWeight: ci === 0 ? 500 : 400,
                      }}
                    >
                      {renderInline(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div
          style={{
            ...mono,
            fontSize: 'var(--type-ui-regular-size)',
            color: MUTED,
            letterSpacing: '0.04em',
            padding: '5px 12px',
            borderTop: `1px solid ${BORDER_SUBTLE}`,
          }}
        >
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

/** Soft section title: short line, no terminal punctuation, not a list/table. */
function looksLikeSectionTitle(line: string, nextNonEmpty: string | undefined): boolean {
  const t = line.trim();
  if (!t || t.length > 56) return false;
  if (/^#{1,4}\s/.test(t)) return false;
  if (/^[-*▸•]\s/.test(t) || /^\d+\.\s/.test(t) || /^>\s/.test(t)) return false;
  if (t.includes('|')) return false;
  if (/[.!?;:]$/.test(t)) return false;
  if (/https?:\/\//i.test(t)) return false;
  // Prefer titles that introduce a table or a short lead-in paragraph
  if (nextNonEmpty && (isTableRow(nextNonEmpty) || nextNonEmpty.length < 160)) return true;
  return /^by\s+/i.test(t) || /^(extra|summary|overview|context|notes|key|top)\b/i.test(t);
}

function MarkdownLine({
  line,
  asSectionTitle,
}: {
  line: string;
  asSectionTitle?: boolean;
}) {
  const isH1 = /^#\s+/.test(line);
  const isH2 = /^##\s+/.test(line);
  const isH3 = /^###\s+/.test(line);
  const isH4 = /^####\s+/.test(line);
  const isBullet = /^[-*•]\s+/.test(line) || /^▸\s+/.test(line);
  const isNumbered = /^\d+\.\s+/.test(line);
  const isHr = /^---+$/.test(line.trim());
  const isBlockquote = /^>\s+/.test(line);

  if (isHr) return <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_SUBTLE}`, margin: '14px 0' }} />;

  const raw = isH1 ? line.replace(/^#\s+/, '')
    : isH2 ? line.replace(/^##\s+/, '')
    : isH3 ? line.replace(/^###\s+/, '')
    : isH4 ? line.replace(/^####\s+/, '')
    : isBullet ? line.replace(/^([-*•]|▸)\s+/, '')
    : isNumbered ? line.replace(/^\d+\.\s+/, '')
    : isBlockquote ? line.replace(/^>\s+/, '')
    : line;

  const inline = renderInline(raw);

  if (isH1) return <div style={{ ...type['title-section'], color: INK, marginTop: 18, marginBottom: 6 }}>{inline}</div>;
  if (isH2 || asSectionTitle) {
    return (
      <div
        style={{
          ...type['body-lg'],
          fontWeight: 600,
          color: INK,
          marginTop: 18,
          marginBottom: 6,
          paddingBottom: 4,
          borderBottom: `1px solid ${BORDER_SUBTLE}`,
        }}
      >
        {inline}
      </div>
    );
  }
  if (isH3) return <div style={{ ...type['body-lg'], fontWeight: 600, color: INK_DIM, marginTop: 12, marginBottom: 4 }}>{inline}</div>;
  if (isH4) return <div style={{ ...type.label, color: MUTED, marginTop: 10, marginBottom: 3 }}>{inline}</div>;
  if (isBullet) return (
    <div style={{ display: 'flex', gap: 8, marginLeft: 2, marginTop: 3, marginBottom: 3, ...type['body-lg'] }}>
      <span style={{ color: GOLD, fontSize: 'var(--type-ui-regular-size)', flexShrink: 0, marginTop: 5 }}>▸</span>
      <span style={{ flex: 1 }}>{inline}</span>
    </div>
  );
  if (isNumbered) {
    const num = /^(\d+)\./.exec(line)?.[1] ?? '1';
    return (
      <div style={{ display: 'flex', gap: 8, marginLeft: 2, marginTop: 3, marginBottom: 3, lineHeight: 1.55 }}>
        <span style={{ ...mono, color: GOLD, fontSize: 'var(--type-ui-regular-size)', flexShrink: 0, minWidth: 16, textAlign: 'right', marginTop: 2 }}>{num}.</span>
        <span style={{ flex: 1 }}>{inline}</span>
      </div>
    );
  }
  if (isBlockquote) return (
    <div style={{ borderLeft: `3px solid ${BORDER_GOLD}`, paddingLeft: 12, color: MUTED, fontStyle: 'italic', margin: '6px 0', lineHeight: 1.55 }}>
      {inline}
    </div>
  );
  if (line === '') return <div style={{ height: 10 }} />;
  return <div style={{ marginBottom: 2, ...type['body-lg'] }}>{inline}</div>;
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
        fontSize: 'var(--type-ui-regular-size)',
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

function renderProseBlocks(prose: string, keyPrefix: string): React.ReactNode[] {
  const lines = prose.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  const nextNonEmpty = (from: number): string | undefined => {
    for (let j = from; j < lines.length; j++) {
      if (lines[j].trim()) return lines[j];
    }
    return undefined;
  };

  while (i < lines.length) {
    const line = lines[i];

    // GFM pipe table: header + separator + rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const aligns = parseAligns(lines[i + 1], headers.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitTableRow(lines[i]);
        rows.push(headers.map((_, ci) => cells[ci] ?? ''));
        i += 1;
      }
      out.push(
        <MarkdownTable
          key={`${keyPrefix}-tbl-${blockKey++}`}
          headers={headers}
          aligns={aligns.length === headers.length ? aligns : headers.map(() => 'left' as ColAlign)}
          rows={rows}
        />,
      );
      continue;
    }

    const section = looksLikeSectionTitle(line, nextNonEmpty(i + 1));
    out.push(
      <MarkdownLine
        key={`${keyPrefix}-ln-${blockKey++}`}
        line={line}
        asSectionTitle={section}
      />,
    );
    i += 1;
  }

  return out;
}

export function AssistantContent({ content }: { content: string }) {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const proseStyle: React.CSSProperties = { ...type['body-lg'], color: INK };

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const prose = content.slice(lastIndex, match.index);
      parts.push(
        <div key={`p-${lastIndex}`} style={proseStyle}>
          {renderProseBlocks(prose, `p${lastIndex}`)}
        </div>,
      );
    }
    const lang = match[1] || 'text';
    const code = match[2];
    parts.push(
      <div key={`c-${match.index}`} style={{ margin: '12px 0', borderRadius: 8, overflow: 'hidden', border: `1px solid ${BORDER_GOLD}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: SURFACE2 }}>
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>{lang}</span>
          <CopyButton text={code} />
        </div>
        <pre style={{ margin: 0, padding: '12px 14px', ...mono, fontSize: 'var(--type-ui-regular-size)', background: SURFACE2, color: INK, overflowX: 'auto', lineHeight: 1.6 }}>
          {code}
        </pre>
      </div>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length || parts.length === 0) {
    const remaining = lastIndex < content.length ? content.slice(lastIndex) : content;
    if (remaining.length > 0 || parts.length === 0) {
      parts.push(
        <div key={`p-${lastIndex}`} style={proseStyle}>
          {renderProseBlocks(remaining, `p${lastIndex}`)}
        </div>,
      );
    }
  }

  return <>{parts}</>;
}


// ── Main StreamingMessage component ───────────────────────────────────────────
export interface StreamingMessageProps {
  activity?: 'thinking' | 'writing';
  /** Only the most recent response animates or announces activity. */
  companionActive?: boolean;
  error?: string | null;
  outcome?: TurnOpsSnapshot['outcome'];
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
  activity,
  companionActive = true,
  error,
  outcome,
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
        <CaptainStatus active={companionActive} isStreaming={isStreaming} content={content} thinking={thinking} activity={activity}
          toolCalls={toolCalls} interrupted={interrupted} error={error} outcome={outcome}
          needsClarification={readiness === 'interview'} />
        {content && <div style={{ padding: '0 20px 16px' }}><AssistantContent content={content} /></div>}
        {error && !isStreaming && <p role="alert" className="px-5 pb-3 text-size-body text-[var(--ink-2)]">{error}</p>}

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
                  ...mono, fontSize: 'var(--type-ui-regular-size)', color: 'rgba(239,68,68,0.8)',
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)',
                  borderRadius: 4, padding: '2px 7px', letterSpacing: '0.04em',
                }}>STOPPED</span>
              )}
              {ts && <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>{ts}</span>}
              {!isStreaming && durationMs != null && (
                <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>
                  {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
              {!isStreaming && tokenCount != null && tokenCount > 0 && (
                <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>
                  {tokenCount.toLocaleString()} tok
                </span>
              )}
              {!isStreaming && shortModel && (
                <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: 'rgba(74,96,128,0.8)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  ...mono, fontSize: 'var(--type-ui-regular-size)', color: copied ? GREEN : MUTED,
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
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
