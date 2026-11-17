'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { AccessNoticeBanner } from '@/components/access/AccessNoticeBanner';
import {
  CHAT_QUERY_RESULT_MAX_ROWS,
  queryResultTabLabel,
  rankQueryResultsForChat,
} from '@/lib/inspector/result-display';
import { filterQueryRowIndices } from '@/lib/workbench/query-table-filter';
import { type } from '@/lib/typography/tokens';

const LINE = 'var(--wb-border-subtle)';
const INK = 'var(--wb-ink)';
const MUTED = 'var(--wb-muted)';
const GOLD = 'var(--brand-a-ink)';
const CHAT_TABLE_SCROLL: React.CSSProperties = {
  maxHeight: 'min(420px, 55vh)',
  overflow: 'auto',
  WebkitOverflowScrolling: 'touch',
};
const FILTER_MIN = 8;

function InlineQueryResultTable({ result, subtitle }: { result: QueryResult; subtitle?: string }) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(
    () => filterQueryRowIndices(result.rows, result.columns, filter).map((i) => result.rows[i]),
    [result.rows, result.columns, filter],
  );
  const filterActive = filter.trim().length > 0;
  const showFilter = result.rows.length >= FILTER_MIN;
  const loaded = result.rows.length;
  const total = result.rowCount;

  const countLabel = filterActive
    ? `${visible.length} of ${loaded} rows match`
    : total > loaded
      ? `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} rows`
      : `${loaded.toLocaleString()} row${loaded === 1 ? '' : 's'}`;

  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${LINE}`,
        overflow: 'hidden',
        background: 'var(--surface-1)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          padding: '8px 12px',
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ ...type.label, color: INK, flexShrink: 0 }}>{countLabel}</span>
          {subtitle ? (
            <span style={{ ...type.caption, color: MUTED }}>{subtitle}</span>
          ) : null}
        </div>
        {showFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '1 1 160px', maxWidth: 300 }}>
            <Search size={14} style={{ color: MUTED, flexShrink: 0 }} aria-hidden />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter rows…"
              aria-label="Filter table rows"
              style={{
                ...type['ui-regular'],
                width: '100%',
                minWidth: 0,
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${LINE}`,
                background: 'var(--wb-canvas)',
                color: INK,
              }}
            />
          </div>
        )}
      </div>
      <div style={CHAT_TABLE_SCROLL}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--type-ui-regular-size)', lineHeight: 1.45 }}>
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col.name}
                  style={{
                    ...type.label,
                    color: GOLD,
                    textAlign: 'left',
                    padding: '10px 14px',
                    borderBottom: `1px solid ${LINE}`,
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    top: 0,
                    background: 'color-mix(in srgb, var(--brand-a) 8%, var(--surface-1))',
                    zIndex: 1,
                  }}
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={result.columns.length} style={{ padding: 20, textAlign: 'center', color: MUTED }}>
                  {filterActive ? 'No rows match your filter.' : 'No rows.'}
                </td>
              </tr>
            ) : (
              visible.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--wb-ink) 3%, transparent)' }}>
                  {result.columns.map((col) => {
                    const raw = row[col.name];
                    const text = raw == null ? '—' : String(raw);
                    return (
                      <td
                        key={col.name}
                        style={{
                          padding: '8px 14px',
                          borderBottom: `1px solid ${LINE}`,
                          color: raw == null ? MUTED : INK,
                          verticalAlign: 'top',
                          maxWidth: 320,
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                        }}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {(result.truncated || result.accessNote) && (
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${LINE}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.truncated && (
            <span style={{ ...type.caption, color: GOLD }}>
              Showing up to {CHAT_QUERY_RESULT_MAX_ROWS.toLocaleString()} rows — use export for more.
            </span>
          )}
          {result.accessNote && (
            <AccessNoticeBanner message={result.accessNote.message} request={result.accessNote.request} />
          )}
        </div>
      )}
    </div>
  );
}

export function AssistantQueryTableOffer({
  indices,
  queryResults,
}: {
  indices: number[];
  queryResults: QueryResult[];
}) {
  const { ordered, primary } = useMemo(
    () => rankQueryResultsForChat(indices, queryResults),
    [indices, queryResults],
  );
  const [active, setActive] = useState(primary);

  useEffect(() => {
    setActive(primary);
  }, [primary, indices.join(',')]);

  const offers = ordered
    .map((i) => ({ i, result: queryResults[i] }))
    .filter((x): x is { i: number; result: QueryResult } => !!x.result && x.result.rows.length > 0);

  if (offers.length === 0) return null;

  const activeOffer = offers.find((o) => o.i === active) ?? offers[0];
  const multi = offers.length > 1;
  const activeTabIndex = offers.findIndex((o) => o.i === activeOffer.i);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: multi ? 10 : 0,
        width: '100%',
        minWidth: 0,
        marginTop: 8,
        marginBottom: 4,
      }}
    >
      {multi ? (
        <p style={{ ...type['ui-regular'], color: MUTED, margin: 0 }}>
          This answer used {offers.length} warehouse queries — browse each dataset below. The{' '}
          <strong style={{ color: INK, fontWeight: 600 }}>main</strong> one is selected first (not every intermediate check).
        </p>
      ) : null}

      {multi ? (
        <div
          role="tablist"
          aria-label="Query result datasets"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {offers.map((o, tabIdx) => {
            const selected = o.i === activeOffer.i;
            return (
              <button
                key={o.i}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(o.i)}
                style={{
                  ...type.ui,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: `1px solid ${selected ? 'color-mix(in srgb, var(--brand-a) 55%, transparent)' : LINE}`,
                  background: selected ? 'color-mix(in srgb, var(--brand-a) 12%, var(--surface-1))' : 'var(--surface-1)',
                  color: selected ? GOLD : MUTED,
                  cursor: 'pointer',
                  fontWeight: selected ? 600 : 500,
                }}
              >
                {queryResultTabLabel(o.result, tabIdx, offers.length)}
              </button>
            );
          })}
        </div>
      ) : null}

      <InlineQueryResultTable
        key={activeOffer.i}
        result={activeOffer.result}
        subtitle={
          multi && activeTabIndex === 0
            ? 'Best match for the answer above'
            : multi
              ? 'Earlier or supporting query from the same turn'
              : undefined
        }
      />
    </div>
  );
}
