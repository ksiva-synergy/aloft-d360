'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/lib/navigation/link';
import { SlidersHorizontal } from 'lucide-react';
import { companionActivity, type ActivityInput } from '@/lib/companion/activity';
import { Companion } from './Companion';
import styles from './Captain.module.css';

/** Seconds since `startedAt` while streaming; null until 3s so quick replies stay quiet. */
function useElapsedSeconds(startedAt: number | null | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  if (!running || startedAt == null) return null;
  const seconds = Math.floor((now - startedAt) / 1000);
  return seconds >= 3 ? seconds : null;
}

function formatElapsed(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function CaptainStatus({ active = true, startedAt, className, ...input }: ActivityInput & {
  active?: boolean;
  /** Epoch ms the turn started; shows a live elapsed counter on long runs. */
  startedAt?: number | null;
  className?: string;
}) {
  const activity = companionActivity(input);
  const elapsed = useElapsedSeconds(startedAt, active && input.isStreaming);
  const wasStreaming = useRef(input.isStreaming);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const finished = wasStreaming.current && !input.isStreaming;
    wasStreaming.current = input.isStreaming;
    if (finished && activity.state === 'success' && active) {
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), 1400);
      return () => clearTimeout(timer);
    }
    setCelebrate(false);
  }, [input.isStreaming, activity.state, active]);
  const face = activity.state === 'success' && !celebrate ? 'idle' : activity.state;
  return <div className={className ? `${styles.status} ${className}` : styles.status} data-companion-status={activity.state}>
    <Companion state={face} active={active} />
    <span className={styles.label} role={active ? 'status' : undefined} aria-live={active ? 'polite' : 'off'}>
      <span key={activity.label} className={styles.labelText}>{activity.label}</span>
      {elapsed != null && <span className={styles.elapsed} aria-hidden="true"> · {formatElapsed(elapsed)}</span>}
    </span>
    {active && <Link href="/settings/profile#companion" className={styles.settings} aria-label="Customize companion" title="Customize companion">
      <SlidersHorizontal size={14} />
    </Link>}
  </div>;
}
