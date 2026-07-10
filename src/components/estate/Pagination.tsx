'use client';

import React from 'react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (newPage: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  const mutedColor = 'var(--estate-text-secondary)';
  const inkColor = 'var(--estate-ink)';
  const borderColor = 'var(--estate-border-gold)';

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '11px',
    color: disabled ? 'var(--estate-text-muted)' : inkColor,
    backgroundColor: 'transparent',
    border: `1px solid ${borderColor}`,
    borderRadius: '4px',
    padding: '5px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'all 0.15s ease',
  });

  return (
    <div
      className="flex items-center justify-between px-5 py-3 border-t shrink-0 select-none bg-[var(--background)]"
      style={{ borderColor }}
    >
      {/* Range Info */}
      <span className="font-mono text-xs" style={{ color: mutedColor }}>
        Showing <span style={{ color: inkColor }}>{from}–{to}</span> of{' '}
        <span style={{ color: inkColor }}>{total}</span> objects
      </span>

      {/* Nav Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={btnStyle(page <= 1)}
          className="hover:border-[#FDB515] hover:text-[#FDB515]"
        >
          &lsaquo; Prev
        </button>

        <span className="font-mono text-xs px-2" style={{ color: inkColor }}>
          Page <span className="font-bold">{page}</span> of {totalPages}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={btnStyle(page >= totalPages)}
          className="hover:border-[#FDB515] hover:text-[#FDB515]"
        >
          Next &rsaquo;
        </button>
      </div>
    </div>
  );
}
