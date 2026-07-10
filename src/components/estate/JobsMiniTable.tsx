'use client';

import React from 'react';
import Link from 'next/link';
import StatusChip from './StatusChip';

export interface JobItem {
  id: string;
  job_kind: string;
  trigger: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

interface JobsMiniTableProps {
  lastJobs: JobItem[];
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const dateObj = new Date(iso);
  const diff = Date.now() - dateObj.getTime();
  if (diff < 0 || diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return dateObj.toLocaleDateString();
}

function getDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—';
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  const diff = finish - start;
  if (isNaN(diff) || diff < 0) return '—';
  return `${(diff / 1000).toFixed(1)}s`;
}

export default function JobsMiniTable({ lastJobs }: JobsMiniTableProps) {
  const borderColor = 'var(--estate-border-gold)';
  const inkColor = 'var(--estate-ink)';
  const labelColor = 'var(--estate-text-secondary)';
  const thBg = 'var(--estate-th-bg)';

  if (!lastJobs || lastJobs.length === 0) {
    return (
      <div
        className="p-8 border border-dashed rounded text-center text-xs font-sans shadow-sm select-none"
        style={{ borderColor, color: labelColor }}
      >
        No recent jobs
      </div>
    );
  }

  return (
    <div className="border rounded overflow-hidden shadow-sm" style={{ borderColor }}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs text-left">
          <thead>
            <tr
              className="sticky top-0 z-10 border-b select-none"
              style={{
                backgroundColor: thBg,
                borderColor: borderColor,
              }}
            >
              <th className="p-2.5 font-mono text-[9px] font-bold tracking-widest uppercase w-32" style={{ color: labelColor }}>Kind</th>
              <th className="p-2.5 font-mono text-[9px] font-bold tracking-widest uppercase w-28" style={{ color: labelColor }}>Trigger</th>
              <th className="p-2.5 font-mono text-[9px] font-bold tracking-widest uppercase w-24" style={{ color: labelColor }}>Status</th>
              <th className="p-2.5 font-mono text-[9px] font-bold tracking-widest uppercase" style={{ color: labelColor }}>Started</th>
              <th className="p-2.5 font-mono text-[9px] font-bold tracking-widest uppercase text-right w-20" style={{ color: labelColor }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {lastJobs.map((job, idx) => (
              <tr
                key={job.id}
                style={{ backgroundColor: idx % 2 === 0 ? 'var(--estate-row-even)' : 'var(--estate-row-odd)', borderBottom: `1px solid ${borderColor}`, height: '36px' }}
                className="transition-colors duration-150 font-sans"
              >
                {/* Kind — links to job detail */}
                <td className="p-2.5 font-mono text-[11px] font-semibold" style={{ color: inkColor }}>
                  <Link
                    href={`/agent-lab/estate/jobs/${job.id}`}
                    className="px-1.5 py-0.5 rounded border bg-black/5 dark:bg-white/5 hover:underline"
                    style={{ borderColor, color: inkColor, textDecoration: 'none' }}
                  >
                    {job.job_kind}
                  </Link>
                </td>
                {/* Trigger */}
                <td className="p-2.5 text-xs" style={{ color: labelColor }}>
                  {job.trigger || '—'}
                </td>
                {/* Status */}
                <td className="p-2.5">
                  <StatusChip status={job.status} />
                </td>
                {/* Started */}
                <td className="p-2.5 text-xs" style={{ color: labelColor }}>
                  {relativeTime(job.started_at)}
                </td>
                {/* Duration */}
                <td className="p-2.5 text-right font-mono text-xs" style={{ color: inkColor }}>
                  {getDuration(job.started_at, job.finished_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
