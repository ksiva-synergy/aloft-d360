'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  X,
  Zap,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import type { ToolCall } from '@/components/agent-lab/workbench/types';
import { CaptainStatus } from '@/components/companion/CaptainStatus';
import { ResponseLoading } from './ResponseLoading';
import chatStyles from './ChatPresentation.module.css';
import type { TurnOpsSnapshot } from '@/components/agent-lab/workbench/types';

import { type } from '@/lib/typography/tokens';
import {
  detailTone,
  labelForKey,
  nestedRecords,
  recordFromJson,
  recordsFromJson,
  splitDetailItem,
  splitDetailItems,
  type DetailKind,
  type DetailTone,
  type JsonRecord,
  type JsonTable,
} from '@/components/workbench/json-table';
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
      borderRadius: 6,
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
  const wordCount = thinking.trim().split(/\s+/).filter(Boolean).length;
  const lines = thinking.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const latestLine = lines[lines.length - 1] ?? '';

  return (
    <div className="ld-card" style={{ marginBottom: 10 }}>
      {isStreaming && <div className="ld-bar" />}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          minWidth: 0,
        }}
      >
        {isStreaming ? (
          <span className="ld-dot" />
        ) : open ? (
          <ChevronDown size={13} style={{ color: MUTED, flexShrink: 0 }} />
        ) : (
          <ChevronRight size={13} style={{ color: MUTED, flexShrink: 0 }} />
        )}
        <span
          className={isStreaming ? 'ld-shimmer-text' : undefined}
          style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', fontWeight: 500, color: isStreaming ? undefined : INK_DIM, flexShrink: 0 }}
        >
          {isStreaming ? 'Reasoning' : 'Thought process'}
        </span>
        {isStreaming && latestLine && !open ? (
          <span
            key={latestLine}
            style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', animation: 'ld-in 200ms ease-out both' }}
          >
            {latestLine}
          </span>
        ) : !isStreaming ? (
          <span style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: MUTED, marginLeft: 'auto' }}>
            {wordCount} words
          </span>
        ) : null}
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
              borderTop: '1px solid var(--line-1)',
              padding: '12px 14px 14px 37px',
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

  const state = tc.status === 'running' ? 'active'
    : tc.status === 'success' ? 'done'
    : tc.status === 'error' ? 'error'
    : 'pending';
  const mark = state === 'active' ? <span className="ld-dot" />
    : state === 'done' ? <Check size={10} strokeWidth={3} />
    : state === 'error' ? <X size={10} strokeWidth={3} />
    : null;
  const name = (tc.toolName || tc.toolId).replace(/^Databricks:\s*/i, '');

  const formatOutput = (val: unknown): string => {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  };

  return (
    <li className="ld-step" data-state={state}>
      <button className="ld-step-row" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="ld-step-mark">{mark}</span>
        <span
          className={state === 'active' ? 'ld-shimmer-text' : undefined}
          style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {name}
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
            <div style={{ margin: '2px 0 8px 27px', padding: 10, borderRadius: 8, background: SURFACE2, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tc.input !== undefined && (
                <div>
                  <div style={{ ...type.label, color: MUTED, marginBottom: 4 }}>Input</div>
                  <pre style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto', margin: 0, background: SURFACE, padding: '6px 10px', borderRadius: 6 }}>
                    {typeof tc.input === 'object' ? JSON.stringify(tc.input, null, 2) : String(tc.input)}
                  </pre>
                </div>
              )}
              {tc.output !== undefined && (
                <div>
                  <div style={{ ...type.label, color: MUTED, marginBottom: 4 }}>Output</div>
                  <pre style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: INK_DIM, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', margin: 0, background: SURFACE, padding: '6px 10px', borderRadius: 6 }}>
                    {formatOutput(tc.output)}
                  </pre>
                </div>
              )}
              {tc.error && (
                <div style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: RED, background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 6 }}>
                  {tc.error}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ToolCallsSection({ toolCalls, isStreaming }: { toolCalls: ToolCall[]; isStreaming: boolean }) {
  const [open, setOpen] = useState(true);
  const runningCount = toolCalls.filter(t => t.status === 'running' || t.status === 'suggested').length;
  const successCount = toolCalls.filter(t => t.status === 'success').length;
  const errorCount = toolCalls.filter(t => t.status === 'error').length;
  const totalDuration = toolCalls.reduce((s, t) => s + (t.durationMs || 0), 0);
  const names = [...new Set(toolCalls.map(t => (t.toolName || t.toolId).replace(/^Databricks:\s*/i, '')))].join(', ');
  const working = isStreaming && runningCount > 0;

  return (
    <div className="ld-card" style={{ marginBottom: 10 }}>
      {working && <div className="ld-bar" />}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {working
          ? <span className="ld-dot" />
          : errorCount > 0
          ? <X size={13} strokeWidth={2.5} style={{ color: RED, flexShrink: 0 }} />
          : <Check size={13} strokeWidth={2.5} style={{ color: GREEN, flexShrink: 0 }} />}
        <span
          className={working ? 'ld-shimmer-text' : undefined}
          style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', fontWeight: 500, color: working ? undefined : INK_DIM, flexShrink: 0 }}
        >
          {working ? 'Working' : `${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''}`}
        </span>
        <span style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {names}
        </span>
        {working && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {successCount}/{toolCalls.length}
          </span>
        )}
        {!isStreaming && totalDuration > 0 && (
          <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED, flexShrink: 0 }}>
            {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: 'var(--bad)', background: 'var(--bad-bg)', padding: '1px 8px', borderRadius: 999, flexShrink: 0 }}>
            {errorCount} failed
          </span>
        )}
        {open
          ? <ChevronDown size={12} style={{ color: MUTED, flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: MUTED, flexShrink: 0 }} />}
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
            <ol className="ld-steps" style={{ padding: '2px 14px 8px', borderTop: '1px solid var(--line-1)' }}>
              {toolCalls.map((tc) => (
                <ToolCallCard key={tc.callId} tc={tc} />
              ))}
            </ol>
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
      <code key={m.index} style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', background: 'color-mix(in srgb, var(--brand-a) 10%, transparent)', color: 'var(--brand-a)', padding: '1px 5px', borderRadius: 6 }}>
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
  toolbar,
  footerNote,
  testId,
}: {
  headers: string[];
  aligns: ColAlign[];
  rows: string[][];
  toolbar?: React.ReactNode;
  footerNote?: string;
  testId?: string;
}) {
  const cellPad: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: `1px solid ${BORDER_SUBTLE}`,
    verticalAlign: 'top',
  };
  const headerPad: React.CSSProperties = {
    ...cellPad,
    whiteSpace: 'nowrap',
  };
  const bodyCell: React.CSSProperties = {
    ...cellPad,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    minWidth: 72,
    maxWidth: 360,
  };

  return (
    <div
      style={{
        margin: '12px 0 16px',
        borderRadius: 10,
        border: `1px solid ${BORDER_SUBTLE}`,
        overflow: 'hidden',
      }}
      data-testid={testId}
    >
      {toolbar ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
          {toolbar}
        </div>
      ) : null}
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
                    ...headerPad,
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
                        ...bodyCell,
                        textAlign: align,
                        color: INK,
                        fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                        ...(numeric ? { ...mono, whiteSpace: 'nowrap', maxWidth: undefined } : {}),
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
          {footerNote ?? `${rows.length} row${rows.length === 1 ? '' : 's'}`}
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
        borderRadius: 6,
        transition: 'color 0.2s',
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function QuietButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        ...mono,
        fontSize: 'var(--type-ui-regular-size)',
        color: MUTED,
        padding: '2px 6px',
        borderRadius: 6,
      }}
    >
      {label}
    </button>
  );
}

function CodeBlockView({ lang, code, extra }: { lang: string; code: string; extra?: React.ReactNode }) {
  return (
    <div data-testid="assistant-code-block" style={{ margin: '12px 0', borderRadius: 8, overflow: 'hidden', border: `1px solid ${BORDER_GOLD}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: SURFACE2 }}>
        <span style={{ ...mono, fontSize: 'var(--type-ui-regular-size)', color: MUTED }}>{lang}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {extra}
          <CopyButton text={code} />
        </span>
      </div>
      <pre style={{ margin: 0, padding: '12px 14px', ...mono, fontSize: 'var(--type-ui-regular-size)', background: SURFACE2, color: INK, overflowX: 'auto', lineHeight: 1.6 }}>
        {code}
      </pre>
    </div>
  );
}

function TabularJsonBlock({ code, table }: { code: string; table: JsonTable }) {
  const [raw, setRaw] = useState(false);
  if (raw) {
    return (
      <CodeBlockView
        lang="json"
        code={code}
        extra={<QuietButton label="Table" onClick={() => setRaw(false)} />}
      />
    );
  }
  return <DataTable code={code} table={table} onShowJson={() => setRaw(true)} />;
}

function RecordJsonBlock({ code, record }: { code: string; record: JsonRecord }) {
  const [raw, setRaw] = useState(false);
  if (raw) {
    return <CodeBlockView lang="json" code={code} extra={<QuietButton label="Record" onClick={() => setRaw(false)} />} />;
  }
  return (
    <div
      data-testid="assistant-data-record"
      style={{ margin: '12px 0 16px', borderRadius: 10, border: `1px solid ${BORDER_SUBTLE}`, overflow: 'hidden' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
          padding: '6px 14px',
          borderBottom: `1px solid ${BORDER_SUBTLE}`,
        }}
      >
        <QuietButton label="JSON" onClick={() => setRaw(true)} />
        <CopyButton text={code} />
      </div>
      <div style={{ padding: '4px 16px' }}>
        <DetailList
          labels={record.sections.map((s) => s.label)}
          values={record.sections.map((s) => s.value)}
          kinds={record.sections.map((s) => s.kind)}
          overview={record.overview}
        />
      </div>
    </div>
  );
}

function structuredJsonBlock(code: string, key?: string): React.ReactNode | null {
  const table = recordsFromJson(code);
  if (table) return <TabularJsonBlock key={key} code={code} table={table} />;
  const record = recordFromJson(code);
  if (record) return <RecordJsonBlock key={key} code={code} record={record} />;
  return null;
}

function rowHasDetails(table: JsonTable, ri: number): boolean {
  return (table.details.rows[ri] ?? []).some((v) => v !== '—');
}

// Expanded-row detail: one band per section, label column left, content right (inspector layout).
const DETAIL_TONE_STYLE: Record<DetailTone, { heading: string; marker: string }> = {
  issue: { heading: 'var(--warn)', marker: 'var(--warn)' },
  action: { heading: GOLD, marker: GOLD },
  neutral: { heading: MUTED, marker: 'color-mix(in srgb, var(--wb-muted) 55%, transparent)' },
};

const DETAIL_TONE_ORDER: Record<DetailTone, number> = { action: 0, issue: 1, neutral: 2 };

const OPEN_ROW_BG = 'color-mix(in srgb, var(--wb-ink) 3%, transparent)';

const FIELD_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

function isZeroValue(value: string): boolean {
  return /^0+(\.0+)?$/.test(value) || /^(no|false)$/i.test(value);
}

/** Detail prose with snake_case field names set in mono, so `closed_by` reads as a column, not a word. */
function renderDetailText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(FIELD_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(...renderInline(text.slice(last, at)).map((n, i) => <React.Fragment key={`${last}-${i}`}>{n}</React.Fragment>));
    parts.push(
      <code
        key={at}
        style={{
          ...type['code-inline'],
          padding: '0 4px',
          borderRadius: 6,
          background: 'color-mix(in srgb, var(--wb-ink) 7%, transparent)',
          color: INK,
        }}
      >
        {m[0]}
      </code>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(...renderInline(text.slice(last)).map((n, i) => <React.Fragment key={`${last}-${i}`}>{n}</React.Fragment>));
  return parts;
}

function FieldGrid({ pairs }: { pairs: Array<{ label: string; value: string }> }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '10px 24px',
        margin: 0,
      }}
    >
      {pairs.map(({ label, value }) => {
        const quiet = isZeroValue(value) || value === '—';
        return (
          <div key={label} style={{ minWidth: 0 }}>
            <dt style={{ ...type.caption, color: MUTED, marginBottom: 2 }}>{label}</dt>
            <dd
              style={{
                margin: 0,
                ...mono,
                fontSize: 'var(--type-ui-regular-size)',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: quiet ? 400 : 600,
                color: quiet ? MUTED : INK,
                wordBreak: 'break-word',
              }}
            >
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function NestedTable({ labels, rows, total }: { labels: string[]; rows: string[][]; total: number }) {
  const cell: React.CSSProperties = {
    padding: '5px 10px',
    borderBottom: `1px solid ${BORDER_SUBTLE}`,
    textAlign: 'left',
    verticalAlign: 'top',
  };
  return (
    <div style={{ overflowX: 'auto', borderRadius: 6, border: `1px solid ${BORDER_SUBTLE}`, background: SURFACE }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...sans, fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.45 }}>
        <thead>
          <tr>
            {labels.map((h) => (
              <th key={h} style={{ ...cell, ...type.label, color: MUTED, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((v, ci) => (
                <td
                  key={ci}
                  style={{
                    ...cell,
                    borderBottom: ri === rows.length - 1 ? 'none' : cell.borderBottom,
                    color: v === '—' ? MUTED : INK,
                    fontWeight: ci === 0 ? 600 : 400,
                    whiteSpace: v.length <= 24 ? 'nowrap' : 'normal',
                  }}
                >
                  {renderInline(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && (
        <div style={{ padding: '5px 10px', color: MUTED, fontSize: 'var(--type-ui-regular-size)' }}>
          Showing {rows.length} of {total}
        </div>
      )}
    </div>
  );
}

function DetailBand({
  label,
  tone,
  count,
  first,
  children,
}: {
  label: string;
  tone: DetailTone;
  count?: number;
  first: boolean;
  children: React.ReactNode;
}) {
  const style = DETAIL_TONE_STYLE[tone];
  const Icon = tone === 'issue' ? AlertTriangle : tone === 'action' ? ArrowRight : null;
  return (
    <section
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 20px',
        padding: '12px 0',
        borderTop: first ? 'none' : `1px solid ${BORDER_SUBTLE}`,
      }}
    >
      <header
        style={{
          flex: '0 0 148px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          ...type.label,
          color: style.heading,
        }}
      >
        {Icon && <Icon size={12} aria-hidden style={{ alignSelf: 'center', flexShrink: 0 }} />}
        <span>{label}</span>
        {count != null && (
          <span style={{ ...type.caption, ...mono, fontVariantNumeric: 'tabular-nums', color: MUTED }}>{count}</span>
        )}
      </header>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>{children}</div>
    </section>
  );
}

function DetailBody({ value, tone, kind }: { value: string; tone: DetailTone; kind: DetailKind }) {
  const nested = kind === 'records' ? nestedRecords(value) : null;
  if (nested) return <NestedTable labels={nested.labels} rows={nested.rows} total={nested.total} />;

  const items = splitDetailItems(value);
  const pairs = items.map((item) => splitDetailItem(item));
  const kv = items.flatMap((_, i) => (pairs[i] ? [pairs[i]!] : []));
  const text = items.filter((_, i) => !pairs[i]);
  const marker = DETAIL_TONE_STYLE[tone].marker;

  if (tone === 'action') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {kv.length > 0 && <FieldGrid pairs={kv.map(({ key, value: v }) => ({ label: labelForKey(key), value: v }))} />}
        {text.map((t, j) => (
          <p key={j} style={{ margin: 0, color: INK, fontWeight: 500, lineHeight: 1.55 }}>{renderDetailText(t)}</p>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {kv.length > 0 && <FieldGrid pairs={kv.map(({ key, value: v }) => ({ label: labelForKey(key), value: v }))} />}
      {text.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            // Issue lists flow into columns so a long gap list stays short.
            ...(tone === 'issue' && text.length > 3 ? { columns: '260px', columnGap: 28 } : {}),
          }}
        >
          {text.map((t, j) => (
            <li
              key={j}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                breakInside: 'avoid',
                padding: '2px 0',
                color: tone === 'issue' ? INK : INK_DIM,
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              {(tone === 'issue' || text.length > 1) && (
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    border: `1.5px solid ${marker}`,
                    transform: 'translateY(-1px)',
                  }}
                />
              )}
              <span>{renderDetailText(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailList({
  labels,
  values,
  kinds,
  overview,
}: {
  labels: string[];
  values: string[];
  kinds?: DetailKind[];
  overview?: Array<{ label: string; value: string }>;
}) {
  const sections = labels
    .map((label, i) => ({ label, value: values[i] ?? '—', kind: kinds?.[i] ?? 'text', tone: detailTone(label), i }))
    .filter((s) => s.value !== '—')
    .sort((a, b) => DETAIL_TONE_ORDER[a.tone] - DETAIL_TONE_ORDER[b.tone] || a.i - b.i);
  const missing = labels.filter((_, i) => (values[i] ?? '—') === '—');
  const hasOverview = !!overview && overview.length > 0;

  return (
    <div>
      {hasOverview && (
        <DetailBand label="Overview" tone="neutral" first>
          <FieldGrid pairs={overview} />
        </DetailBand>
      )}
      {sections.map((s, n) => {
        const nested = s.kind === 'records' ? nestedRecords(s.value) : null;
        const count = nested ? nested.total : s.tone === 'issue' ? splitDetailItems(s.value).length : undefined;
        return (
          <DetailBand key={s.label} label={s.label} tone={s.tone} count={count && count > 1 ? count : undefined} first={!hasOverview && n === 0}>
            <DetailBody value={s.value} tone={s.tone} kind={s.kind} />
          </DetailBand>
        );
      })}
      {missing.length > 0 && (
        <DetailBand label="Not provided" tone="neutral" first={!hasOverview && sections.length === 0}>
          <span style={{ color: MUTED, fontSize: 'var(--type-ui-regular-size)' }}>{missing.join(', ')}</span>
        </DetailBand>
      )}
    </div>
  );
}

function DataTable({ code, table, onShowJson }: { code: string; table: JsonTable; onShowJson: () => void }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const hasDetails = table.details.labels.length > 0;
  const expandable = table.rows.map((_, ri) => hasDetails && rowHasDetails(table, ri));
  const anyExpandable = expandable.some(Boolean);
  const allOpen = anyExpandable && expandable.every((can, ri) => !can || open.has(ri));

  const toggle = (ri: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(ri)) next.delete(ri);
      else next.add(ri);
      return next;
    });
  };
  const toggleAll = () => {
    setOpen(allOpen ? new Set() : new Set(expandable.flatMap((can, ri) => (can ? [ri] : []))));
  };

  const cell: React.CSSProperties = {
    padding: '10px 14px',
    borderBottom: `1px solid ${BORDER_SUBTLE}`,
    verticalAlign: 'top',
    textAlign: 'left',
  };
  const colSpan = table.labels.length + (anyExpandable ? 1 : 0);
  const countLabel = table.truncated
    ? `Showing ${table.rows.length} of ${table.total} rows`
    : `${table.total} row${table.total === 1 ? '' : 's'}`;

  return (
    <div
      data-testid="assistant-data-table"
      style={{ margin: '12px 0 16px', borderRadius: 10, border: `1px solid ${BORDER_SUBTLE}`, overflow: 'hidden' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 14px',
          borderBottom: `1px solid ${BORDER_SUBTLE}`,
        }}
      >
        <span style={{ ...type.label, color: MUTED }}>{countLabel}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {anyExpandable && <QuietButton label={allOpen ? 'Collapse all' : 'Expand all'} onClick={toggleAll} />}
          <QuietButton label="JSON" onClick={onShowJson} />
          <CopyButton text={code} />
        </span>
      </div>

      {table.shared.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: '6px 18px',
            padding: '10px 14px',
            borderBottom: `1px solid ${BORDER_SUBTLE}`,
            fontSize: 'var(--type-ui-regular-size)',
          }}
        >
          <span style={{ ...type.label, color: MUTED }}>Same for all rows</span>
          {table.shared.map((s) => (
            <span key={s.label} style={{ color: INK_DIM }}>
              {s.label}: <span style={{ color: INK, fontWeight: 500 }}>{s.value}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...sans, fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.45 }}>
          <thead>
            <tr style={{ background: 'color-mix(in srgb, var(--brand-a) 6%, transparent)' }}>
              {anyExpandable && <th style={{ ...cell, width: 36, borderBottom: `1px solid ${BORDER_GOLD}` }} aria-label="Details" />}
              {table.labels.map((h, i) => (
                <th
                  key={h}
                  style={{
                    ...cell,
                    ...type.label,
                    color: MUTED,
                    whiteSpace: 'nowrap',
                    textAlign: table.aligns[i] ?? 'left',
                    borderBottom: `1px solid ${BORDER_GOLD}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => {
              const isOpen = open.has(ri);
              const canOpen = expandable[ri];
              return (
                <React.Fragment key={ri}>
                  <tr
                    onClick={canOpen ? () => toggle(ri) : undefined}
                    style={{
                      cursor: canOpen ? 'pointer' : undefined,
                      background: isOpen ? OPEN_ROW_BG : undefined,
                    }}
                  >
                    {anyExpandable && (
                      <td style={{ ...cell, width: 36, paddingRight: 0, borderBottom: isOpen ? 'none' : cell.borderBottom }}>
                        {canOpen && (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={isOpen ? 'Hide details' : 'Show details'}
                            onClick={(e) => { e.stopPropagation(); toggle(ri); }}
                            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: MUTED, display: 'inline-flex' }}
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                    )}
                    {row.map((value, ci) => {
                      const numeric = table.aligns[ci] === 'right';
                      return (
                        <td
                          key={ci}
                          style={{
                            ...cell,
                            borderBottom: isOpen ? 'none' : cell.borderBottom,
                            textAlign: table.aligns[ci] ?? 'left',
                            color: value === '—' ? MUTED : INK,
                            fontWeight: ci === 0 ? 600 : 400,
                            whiteSpace: numeric || value.length <= 24 ? 'nowrap' : 'normal',
                            ...(numeric ? { ...mono, fontVariantNumeric: 'tabular-nums' } : {}),
                          }}
                        >
                          {renderInline(value)}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && (
                    <tr style={{ background: OPEN_ROW_BG }}>
                      <td colSpan={colSpan} style={{ padding: '0 14px 12px 20px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
                        {/* Guide line drops from the chevron so the panel reads as this row's children. */}
                        <div style={{ borderLeft: `1px solid ${BORDER_SUBTLE}`, paddingLeft: 29 }}>
                          <DetailList labels={table.details.labels} values={table.details.rows[ri]} kinds={table.details.kinds} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fencedBlock(lang: string, code: string): React.ReactNode {
  const trimmed = code.trim();
  const structured = trimmed.startsWith('[') || trimmed.startsWith('{') ? structuredJsonBlock(trimmed) : null;
  if (structured) return structured;
  return <CodeBlockView lang={lang} code={code} />;
}

function renderProseSection(prose: string, key: string, proseStyle: React.CSSProperties): React.ReactNode {
  const trimmed = prose.trim();
  if (trimmed && (trimmed[0] === '[' || trimmed[0] === '{')) {
    const structured = structuredJsonBlock(trimmed, key);
    if (structured) return structured;
  }
  return (
    <div key={key} style={proseStyle}>
      {renderProseBlocks(prose, key)}
    </div>
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
  const whole = !content.includes('```') && /^\s*[[{]/.test(content) ? structuredJsonBlock(content.trim()) : null;
  if (whole) return whole;

  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const proseStyle: React.CSSProperties = { ...type['body-lg'], color: INK };

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const prose = content.slice(lastIndex, match.index);
      parts.push(renderProseSection(prose, `p-${lastIndex}`, proseStyle));
    }
    const lang = (match[1] || 'text').toLowerCase();
    const code = match[2];
    parts.push(<React.Fragment key={`c-${match.index}`}>{fencedBlock(lang, code)}</React.Fragment>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length || parts.length === 0) {
    const remaining = lastIndex < content.length ? content.slice(lastIndex) : content;
    if (remaining.length > 0 || parts.length === 0) {
      parts.push(renderProseSection(remaining, `p-${lastIndex}`, proseStyle));
    }
  }

  return <>{parts}</>;
}


// ── Main StreamingMessage component ───────────────────────────────────────────
export interface StreamingMessageProps {
  cleanPresentation?: boolean;
  responseVisuals?: React.ReactNode;
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
  /** When false, the raw tool-step list stays hidden. The companion still shows progress. */
  showToolCalls?: boolean;
  /** Pass false for members and admins with developer mode off. */
  showTechnicalToolNames?: boolean;
}

export function StreamingMessage({
  cleanPresentation = false,
  responseVisuals,
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
  showToolCalls = true,
  showTechnicalToolNames = false,
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
      {showToolCalls && toolCalls && toolCalls.length > 0 && (
        <ToolCallsSection toolCalls={toolCalls} isStreaming={isStreaming} />
      )}



      {/* Main content card */}
      <motion.div
        className={cleanPresentation && responseVisuals ? chatStyles.report : undefined}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        style={{
          background: cleanPresentation || (!content.trim() && !error) ? 'transparent' : SURFACE,
          borderRadius: 8,
          border: cleanPresentation || (!content.trim() && !error) ? '1px solid transparent' : `1px solid ${BORDER_SUBTLE}`,
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
          maxWidth: '100%',
        }}
      >
        {isStreaming && !content.trim() ? (
          <ResponseLoading active={companionActive} isStreaming={isStreaming} content={content} thinking={thinking}
            activity={activity} toolCalls={toolCalls} showTechnicalToolNames={showTechnicalToolNames} />
        ) : (!cleanPresentation || isStreaming || interrupted || error || outcome === 'errored' || outcome === 'truncated' || readiness === 'interview' || toolCalls?.some(t => t.status === 'error')) && <CaptainStatus variant={!content.trim() ? 'compact' : 'default'} active={companionActive} isStreaming={isStreaming} content={content} thinking={thinking} activity={activity}
          toolCalls={toolCalls} interrupted={interrupted} error={error} outcome={outcome}
          showTechnicalToolNames={showTechnicalToolNames}
          needsClarification={readiness === 'interview'} />}
        {content && (
          <div className={cleanPresentation ? chatStyles.answer : undefined} style={{ padding: cleanPresentation ? '8px 0 18px' : '0 clamp(12px, 2vw, 24px) 16px', maxWidth: '100%' }}>
            <AssistantContent content={content} />
          </div>
        )}
        {error && !isStreaming && <p role="alert" className="px-5 pb-3 text-size-body text-[var(--ink-2)]">{error}</p>}

        {responseVisuals}

        {/* Footer: readiness badge + timestamp + tokens + duration + model + copy */}
        {(!isStreaming || (!cleanPresentation && (readiness || ts))) && (content || interrupted) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: cleanPresentation ? '4px 0 10px' : '6px 16px 10px',
            borderTop: cleanPresentation ? 'none' : `1px solid ${BORDER_SUBTLE}`,
            flexWrap: 'wrap',
            gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {readiness && <ReadinessBadge value={readiness} />}
              {interrupted && !isStreaming && (
                <span style={{
                  ...mono, fontSize: 'var(--type-ui-regular-size)', color: 'rgba(239,68,68,0.8)',
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)',
                  borderRadius: 6, padding: '2px 7px', letterSpacing: '0.04em',
                }}>STOPPED</span>
              )}
              {(ts || durationMs != null || (tokenCount != null && tokenCount > 0) || shortModel) && (
                <details className={chatStyles.details} open={cleanPresentation ? undefined : true}>
                  <summary className={cleanPresentation ? chatStyles.summary : chatStyles.hiddenSummary}>Details</summary>
                  <div className={chatStyles.metadata}>
                    {ts && <span>Sent at {ts}</span>}
                    {!isStreaming && durationMs != null && (
                      <span>{durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`} duration</span>
                    )}
                    {!isStreaming && tokenCount != null && tokenCount > 0 && <span>{tokenCount.toLocaleString()} tokens</span>}
                    {!isStreaming && shortModel && <span>{shortModel}</span>}
                  </div>
                </details>
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
