'use client';

import React, { useState } from 'react';

export interface ProfileHistoryItem {
  id: string;
  version: number;
  captured_at: string;
  trigger: string;
  drift: any | null;
}

interface ProfileTimelineProps {
  profileHistory: ProfileHistoryItem[];
}

function relativeTime(iso: string): string {
  const dateObj = new Date(iso);
  const diff = Date.now() - dateObj.getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return dateObj.toLocaleDateString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DriftValue({ label, value }: { label: string; value: any }) {
  const [expanded, setExpanded] = useState(false);
  const mutedColor = 'var(--estate-text-muted)';

  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="flex items-start gap-2 text-[11px] font-mono">
          <span className="font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">{label}:</span>
          <span style={{ color: mutedColor }}>[]</span>
        </div>
      );
    }
    return (
      <div className="text-[11px] font-mono">
        <button
          type="button"
          className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300 bg-transparent border-none cursor-pointer p-0 hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          <span
            className="inline-block text-[9px] transition-transform duration-150"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          {label}: [{value.length} item{value.length !== 1 ? 's' : ''}]
        </button>
        {expanded && (
          <div className="mt-1 ml-3 pl-2 py-1 text-[10px] overflow-x-auto max-h-[120px] overflow-y-auto rounded"
            style={{ borderLeft: '2px solid rgba(245,158,11,0.3)', color: 'var(--estate-text-secondary)' }}
          >
            {value.map((item: any, i: number) => (
              <div key={i} className="py-0.5 break-all">
                {typeof item === 'object' ? JSON.stringify(item, null, 0) : String(item)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object' && value !== null) {
    if (value.from !== undefined && value.to !== undefined) {
      return (
        <div className="flex items-start gap-2 text-[11px] font-mono">
          <span className="font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">{label}:</span>
          <span className="text-amber-800 dark:text-amber-200 break-all">{String(value.from)} → {String(value.to)}</span>
        </div>
      );
    }
    const jsonStr = JSON.stringify(value);
    const isLong = jsonStr.length > 60;
    return (
      <div className="text-[11px] font-mono">
        {isLong ? (
          <>
            <button
              type="button"
              className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300 bg-transparent border-none cursor-pointer p-0 hover:underline"
              onClick={() => setExpanded(!expanded)}
            >
              <span
                className="inline-block text-[9px] transition-transform duration-150"
                style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▶
              </span>
              {label}: {'{...}'}
            </button>
            {expanded && (
              <div className="mt-1 ml-3 pl-2 py-1 text-[10px] overflow-x-auto max-h-[120px] overflow-y-auto rounded break-all"
                style={{ borderLeft: '2px solid rgba(245,158,11,0.3)', color: 'var(--estate-text-secondary)' }}
              >
                {JSON.stringify(value, null, 2)}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">{label}:</span>
            <span className="text-amber-800 dark:text-amber-200 break-all">{jsonStr}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-[11px] font-mono">
      <span className="font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap shrink-0">{label}:</span>
      <span className="text-amber-800 dark:text-amber-200">{String(value)}</span>
    </div>
  );
}

function DriftSummary({ drift }: { drift: any }) {
  if (!drift || typeof drift !== 'object') return null;
  const keys = Object.keys(drift);
  if (keys.length === 0) return null;

  const hasSignificantDrift = keys.some((k) => {
    const v = drift[k];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'object' && v !== null) return Object.keys(v).length > 0;
    return Boolean(v);
  });

  if (!hasSignificantDrift) {
    return (
      <div className="mt-2 text-[11px] font-sans italic" style={{ color: 'var(--estate-text-muted)' }}>
        No significant changes
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {keys.map((k) => (
        <DriftValue key={k} label={k} value={drift[k]} />
      ))}
    </div>
  );
}

export default function ProfileTimeline({ profileHistory }: ProfileTimelineProps) {
  const labelColor = 'var(--estate-text-secondary)';
  const mutedColor = 'var(--estate-text-muted)';
  const cardBg = 'var(--estate-raised)';
  const borderColor = 'var(--estate-border-gold)';
  const [showAll, setShowAll] = useState(false);

  if (!profileHistory || profileHistory.length === 0) {
    return (
      <div className="p-4 text-center text-xs font-sans" style={{ color: labelColor }}>
        No profile history available
      </div>
    );
  }

  const VISIBLE_LIMIT = 3;
  const displayedHistory = showAll ? profileHistory : profileHistory.slice(0, VISIBLE_LIMIT);
  const hasMore = profileHistory.length > VISIBLE_LIMIT;

  return (
    <div>
      <div className="relative pl-6 space-y-4">
        {/* Vertical Timeline Line */}
        <div
          className="absolute left-2.5 top-2.5 bottom-2.5 w-0.5"
          style={{ backgroundColor: 'rgba(253, 181, 21, 0.2)' }}
        />

        {displayedHistory.map((item) => {
          const hasDrift = item.drift && typeof item.drift === 'object' && Object.keys(item.drift).length > 0;
          const relative = relativeTime(item.captured_at);
          const absolute = formatDate(item.captured_at);

          const entryBg = hasDrift
            ? 'rgba(245, 158, 11, 0.06)'
            : cardBg;

          const entryBorder = hasDrift
            ? 'rgba(245, 158, 11, 0.3)'
            : borderColor;

          return (
            <div key={item.id} className="relative flex flex-col gap-2">
              {/* Dot on line */}
              <div
                className="absolute -left-[21.5px] top-2.5 w-3.5 h-3.5 rounded-full border-2 transition-all duration-200"
                style={{
                  backgroundColor: hasDrift ? '#F59E0B' : '#FDB515',
                  borderColor: entryBg,
                  boxShadow: hasDrift ? '0 0 6px rgba(245, 158, 11, 0.4)' : 'none',
                }}
              />

              {/* Entry Card */}
              <div
                className="border rounded-lg p-4 shadow-sm transition-all duration-200 overflow-hidden"
                style={{
                  backgroundColor: entryBg,
                  borderColor: entryBorder,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[#FDB515]">
                      v{item.version}
                    </span>
                    {hasDrift && (
                      <span className="font-mono text-[10px] text-amber-500">⚡ drift</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="font-mono text-[11px]" style={{ color: labelColor }} title={absolute}>
                      {relative}
                    </div>
                    <div className="font-mono text-[10px]" style={{ color: mutedColor }}>
                      {new Date(item.captured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>

                {hasDrift && (
                  <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(245,158,11,0.15)' }}>
                    <div className="text-[11px] font-sans font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 select-none mb-1">
                      <span>⚡</span> Drift detected
                    </div>
                    <DriftSummary drift={item.drift} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(o => !o)}
          className="mt-3 ml-6 font-mono text-[11px] hover:underline"
          style={{ color: '#FDB515', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {showAll ? '↑ Show less' : `↓ Show ${profileHistory.length - VISIBLE_LIMIT} more versions`}
        </button>
      )}
    </div>
  );
}
