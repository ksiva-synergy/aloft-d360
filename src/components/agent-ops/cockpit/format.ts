import type React from 'react';
import { extractSqlFromInput } from '../SqlPreview';

export const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
export const sans: React.CSSProperties = { fontFamily: "'DM Sans Variable', 'Inter Variable', system-ui, sans-serif" };

export const OK = '#22c55e';
export const ERR = '#D9774B';
export const WARN = '#f59e0b';
export const BORDER = '1px solid var(--wb-border-subtle)';
export const CARD_BG = 'color-mix(in srgb, var(--wb-surface) 45%, transparent)';

/** Stable per-tool colors so the same tool reads the same everywhere on the page. */
export const TOOL_PALETTE = ['var(--brand-a)', 'var(--brand-b)', '#14b8a6', '#f59e0b', '#ec4899', '#84cc16', '#a855f7', '#64748b'];

export type ColorOf = (tool: string) => string;

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtUsd(n: number): string {
  if (n < 0.01 && n > 0) return '<$0.01';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';
}

/** One-line hint of what a call did: first SQL line, or the first short scalar argument. */
export function summarizeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const sql = extractSqlFromInput(input as Record<string, unknown>);
  if (sql) return sql.replace(/\s+/g, ' ').trim();
  const obj = input as Record<string, unknown>;
  const args = obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args) ? (obj.args as Record<string, unknown>) : obj;
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 0) return `${k}: ${v}`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${String(v)}`;
  }
  return null;
}

export function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
