'use client';

import { AlertTriangle, Building2, CheckCircle2, Clock, Loader2, Lock } from 'lucide-react';
import { Chip } from '@/views/agent-lab/flows/ui';

// Shapes returned by /api/knowledge (src/lib/knowledge/service.ts), and small display helpers.

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  scope: 'personal' | 'org' | 'team';
  ownerName: string | null;
  mine: boolean;
  canManage: boolean;
  archived: boolean;
  documents: number;
  pieces: number;
  lastIndexedAt: string | null;
  createdAt: string | null;
};

export type KnowledgeDocument = {
  id: string;
  kind: 'file' | 'qa';
  name: string;
  folder: string | null;
  version: number;
  status: 'pending' | 'indexing' | 'indexed' | 'failed' | string;
  error: string | null;
  pages: number | null;
  pieces: number;
  ocrPages: number;
  failedPages: number[];
  sizeBytes: number | null;
  question: string | null;
  answer: string | null;
  uploadedByName: string | null;
  createdAt: string;
  indexedAt: string | null;
  replacing: boolean;
};

export type Citation = {
  text: string;
  knowledgeBaseId: string;
  documentId: string | null;
  document: string | null;
  version: number | null;
  section: string | null;
  page: number | null;
  kind: string;
  score: number;
  matchedBy: 'meaning' | 'words' | 'both';
};

export type PageContext = { isAdmin: boolean; uploads: { ready: boolean; maxMb: number } };

export const field =
  'h-9 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2.5 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';
export const area =
  'w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2.5 py-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

export async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { ok: res.ok, status: res.status, data: await readJson<T>(res) };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server' } as T & { error?: string } };
  }
}

export const fileSize = (n: number | null | undefined) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Pages 3, 7 and 12" for the pages OCR could not read. */
export function pageList(pages: number[]): string {
  const p = pages.slice(0, 8).map(String);
  const more = pages.length > 8 ? ` and ${pages.length - 8} more` : '';
  if (p.length === 1) return `Page ${p[0]}`;
  return `Pages ${p.slice(0, -1).join(', ')}${more ? `, ${p.at(-1)}${more}` : ` and ${p.at(-1)}`}`;
}

export function ScopeChip({ kb }: { kb: Pick<KnowledgeBase, 'scope' | 'mine' | 'ownerName'> }) {
  if (kb.scope === 'org')
    return (
      <Chip>
        <Building2 className="h-3 w-3" aria-hidden /> Organisation
      </Chip>
    );
  return (
    <Chip>
      <Lock className="h-3 w-3" aria-hidden /> {kb.mine ? 'Only you' : `Personal · ${kb.ownerName ?? 'a colleague'}`}
    </Chip>
  );
}

export function DocStatus({ d }: { d: Pick<KnowledgeDocument, 'status' | 'failedPages'> }) {
  if (d.status === 'indexed' && d.failedPages.length)
    return (
      <Chip tone="warn">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Ready, {plural(d.failedPages.length, 'page')} unread
      </Chip>
    );
  if (d.status === 'indexed')
    return (
      <Chip tone="ok">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready
      </Chip>
    );
  if (d.status === 'indexing')
    return (
      <Chip tone="brand">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reading
      </Chip>
    );
  if (d.status === 'failed')
    return (
      <Chip tone="bad">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Failed
      </Chip>
    );
  return (
    <Chip>
      <Clock className="h-3 w-3" aria-hidden /> Waiting
    </Chip>
  );
}

export const inProgress = (d: Pick<KnowledgeDocument, 'status'>) => d.status === 'pending' || d.status === 'indexing';
