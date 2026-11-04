'use client';

// AgentKnowledgePanel — shows the exact text agents retrieve for this object.
//
// Source: knowledge_chunks rows written by syncObjectToKnowledge
// (src/lib/context/knowledge-sync.ts) with doc_ref `context:<full_path>:<doc>`,
// returned on the object aggregate as `agentKnowledge`. Lets a steward check
// what an agent is told (row counts, descriptions, PII notes) before trusting
// its answers. Read-only; collapsed by default.

import React from 'react';
import { type } from '@/lib/typography/tokens';

export interface AgentKnowledgeChunk {
  doc_ref: string;
  chunk_index: number;
  content: string;
  created_at: string;
}

interface AgentKnowledgePanelProps {
  fullPath: string;
  chunks: AgentKnowledgeChunk[];
  lastSyncAt: string | null;
  hasEmbedding: boolean;
}

// doc_ref suffixes shown as stored (schema, semantic, samples).
const DOC_LABELS: Record<string, string> = {};

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AgentKnowledgePanel({ fullPath, chunks, lastSyncAt, hasEmbedding }: AgentKnowledgePanelProps) {
  const prefix = `context:${fullPath}:`;
  const docs = new Map<string, AgentKnowledgeChunk[]>();
  for (const c of chunks) {
    const key = c.doc_ref.startsWith(prefix) ? c.doc_ref.slice(prefix.length) : c.doc_ref;
    const list = docs.get(key) ?? [];
    list.push(c);
    docs.set(key, list);
  }
  const synced = formatWhen(lastSyncAt);

  return (
    <details
      style={{
        border: '1px solid var(--estate-border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--estate-raised)',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          listStyle: 'revert',
        }}
      >
        <span style={{ ...type['title-card'], color: 'var(--estate-ink)' }}>
          What agents see
        </span>
        <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }}>
          {chunks.length === 0
            ? 'Not in agent knowledge yet'
            : `${docs.size} document${docs.size === 1 ? '' : 's'} · ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`}
          {synced ? ` · synced ${synced}` : ''}
          {chunks.length > 0 && !hasEmbedding ? ' · search index missing' : ''}
        </span>
      </summary>

      <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--estate-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {chunks.length === 0 ? (
          <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--type-ui-regular-size)', color: 'var(--estate-text-muted)' }}>
            Agents cannot retrieve this table yet. It is added to agent knowledge after it has been described (T2) and synced.
          </p>
        ) : (
          [...docs.entries()].map(([key, list]) => (
            <div key={key}>
              <div style={{ ...type.label, color: 'var(--estate-text-secondary)', marginBottom: 6 }}>
                {DOC_LABELS[key] ?? key}
              </div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 320,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--type-ui-regular-size)',
                  lineHeight: 1.5,
                  color: 'var(--estate-text-secondary)',
                  background: 'var(--estate-bg)',
                  border: '1px solid var(--estate-border)',
                  borderRadius: 6,
                  padding: '10px 12px',
                }}
              >
                {list.map((c) => c.content).join('\n\n')}
              </pre>
            </div>
          ))
        )}
      </div>
    </details>
  );
}
