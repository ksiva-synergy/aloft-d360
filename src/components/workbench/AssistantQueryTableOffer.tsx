'use client';

import React, { useState } from 'react';
import { Table2 } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { ChatFullTableDialog } from '@/components/workbench/ChatFullTableDialog';
import { CHAT_TABLE_ROWS_WITH_PANEL } from '@/lib/inspector/result-display';
import { type } from '@/lib/typography/tokens';

const GOLD = 'var(--brand-a)';
const INK = 'var(--wb-ink-dim)';

export function AssistantQueryTableOffer({
  indices,
  queryResults,
}: {
  indices: number[];
  queryResults: QueryResult[];
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const offers = indices
    .map((i) => ({ i, result: queryResults[i] }))
    .filter((x): x is { i: number; result: QueryResult } => !!x.result && x.result.rows.length > 0);

  if (offers.length === 0) return null;

  const active = openIdx != null ? offers.find((o) => o.i === openIdx) : undefined;

  return (
    <>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 4,
          marginBottom: 2,
        }}
      >
        {offers.map(({ i, result }, n) => {
          const count = result.rowCount || result.rows.length;
          const previewCap = CHAT_TABLE_ROWS_WITH_PANEL;
          const label =
            offers.length > 1
              ? `Open table ${n + 1} (${count.toLocaleString()} rows)`
              : count > previewCap
                ? `Open full table (${count.toLocaleString()} rows)`
                : `Open table (${count.toLocaleString()} rows)`;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIdx(i)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid color-mix(in srgb, ${GOLD} 35%, transparent)`,
                background: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
                color: INK,
                cursor: 'pointer',
                ...type['ui-regular'],
                fontWeight: 500,
              }}
            >
              <Table2 size={14} style={{ color: GOLD, flexShrink: 0 }} aria-hidden />
              {label}
            </button>
          );
        })}
        <span style={{ ...type.caption, color: 'var(--wb-muted)', alignSelf: 'center' }}>
          Search &amp; filter — full query data, not the chat preview.
        </span>
      </div>
      {active && (
        <ChatFullTableDialog
          result={active.result}
          title={offers.length > 1 ? `Query ${offers.findIndex((o) => o.i === active.i) + 1}` : 'Full table'}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </>
  );
}
