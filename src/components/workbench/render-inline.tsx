'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const INK = 'var(--wb-ink)';
const GREEN = 'var(--good)';
const MUTED = 'var(--wb-muted)';

export type RenderInlineOptions = {
  /** In tables: hide raw URLs; show a labeled open action and Copy link. */
  compactLinks?: boolean;
};

const BARE_URL = /https?:\/\/[^\s|)\]<>"]+/i;

function linkLabelFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const base = path.split('/').filter(Boolean).pop();
    if (base && base.length <= 48) return base.replace(/\.(pdf|docx?|xlsx?)$/i, (m) => m);
  } catch {
    /* ignore */
  }
  return 'Open link';
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      title="Copy link"
      aria-label="Copy link"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        ...mono,
        fontSize: 'var(--type-ui-regular-size)',
        color: copied ? GREEN : MUTED,
        padding: '0 4px',
        borderRadius: 6,
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}

function OpenLink({ href, label, compact }: { href: string; label: string; compact?: boolean }) {
  const anchor = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        color: 'var(--brand-a)',
        fontWeight: 500,
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  );
  if (!compact) return anchor;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {anchor}
      <CopyLinkButton url={href} />
    </span>
  );
}

/**
 * Inline markdown: bold, italic, code, [label](url), and optional bare URLs.
 */
export function renderInline(text: string, options?: RenderInlineOptions): React.ReactNode[] {
  const compact = options?.compactLinks ?? false;
  const tokenRegex =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`|(https?:\/\/[^\s|)\]<>"]+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    if (m[1] != null && m[2] != null) {
      parts.push(<OpenLink key={key++} href={m[2]} label={m[1]} compact={compact} />);
    } else if (m[3] != null) {
      parts.push(<strong key={key++} style={{ fontWeight: 600, color: INK }}>{m[3]}</strong>);
    } else if (m[4] != null) {
      parts.push(<em key={key++}>{m[4]}</em>);
    } else if (m[5] != null) {
      parts.push(
        <code
          key={key++}
          style={{
            ...mono,
            fontSize: 'var(--type-ui-regular-size)',
            background: 'color-mix(in srgb, var(--brand-a) 10%, transparent)',
            color: 'var(--brand-a)',
            padding: '1px 5px',
            borderRadius: 6,
          }}
        >
          {m[5]}
        </code>,
      );
    } else if (m[6] != null) {
      const href = m[6];
      if (compact) {
        parts.push(
          <OpenLink key={key++} href={href} label={linkLabelFromUrl(href)} compact />,
        );
      } else {
        parts.push(<OpenLink key={key++} href={href} label={linkLabelFromUrl(href)} />);
      }
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

/** True when a table cell is only a URL (or markdown link). */
export function isPrimarilyLink(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/^\[[^\]]+\]\([^)]+\)$/.test(t)) return true;
  if (BARE_URL.test(t) && t.replace(BARE_URL, '').trim() === '') return true;
  return false;
}
