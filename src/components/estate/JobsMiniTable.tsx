'use client';

// JobsMiniTable — the last few harvest jobs that touched this object, as a
// compact list: what ran, its status, when, how long, and why (trigger).
// Each row opens the job page.

import React from 'react';
import Link from '@/lib/navigation/link';
import StatusChip from './StatusChip';
import { Card, EmptyNote, relTime, fullTime } from './object-ui';
import { type } from '@/lib/typography/tokens';

export interface JobItem {
  id: string;
  job_kind: string;
  trigger: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error?: string | null;
}

interface JobsMiniTableProps {
  lastJobs: JobItem[];
}

// job_kind and trigger are shown as stored (t1_profile, on_demand, …).

function duration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function JobsMiniTable({ lastJobs }: JobsMiniTableProps) {
  return (
    <Card
      title="Recent jobs"
      style={{ height: "100%" }}
      meta={lastJobs.length > 0 ? `Last ${lastJobs.length}` : undefined}
      actions={
        <Link href="/agent-lab/estate/jobs" style={{ ...type.ui, color: 'var(--brand-a-ink)', textDecoration: 'none' }} className="hover:underline">
          All jobs →
        </Link>
      }
      flush={lastJobs.length > 0}
    >
      {lastJobs.length === 0 ? (
        <EmptyNote>No jobs have run for this table yet.</EmptyNote>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {lastJobs.map((job, i) => {
            const dur = duration(job.started_at, job.finished_at);
            const trigger = job.trigger ?? null;
            return (
              <li key={job.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--estate-border)' }}>
                <Link
                  href={`/agent-lab/estate/jobs/${job.id}`}
                  className="hover:bg-[var(--estate-hover)] transition-colors"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', textDecoration: 'none' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ ...type.ui, color: 'var(--estate-ink)', fontWeight: 500 }}>
                      <code style={type['code-inline']}>{job.job_kind}</code>
                    </span>
                    <span style={{ ...type.caption, color: 'var(--estate-text-muted)' }} title={fullTime(job.started_at)}>
                      {[relTime(job.started_at ?? null), dur, trigger].filter(Boolean).join(' · ')}
                    </span>
                    {job.error && (
                      <span
                        title={job.error}
                        style={{ ...type.caption, color: 'var(--estate-status-error-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {job.error}
                      </span>
                    )}
                  </div>
                  <StatusChip status={job.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
