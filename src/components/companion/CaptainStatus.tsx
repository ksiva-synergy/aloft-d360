'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { companionActivity, type ActivityInput } from '@/lib/companion/activity';
import { Companion } from './Companion';
import styles from './Captain.module.css';

export function CaptainStatus({ active = true, ...input }: ActivityInput & { active?: boolean }) {
  const activity = companionActivity(input);
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
  return <div className={styles.status} data-companion-status={activity.state}>
    <Companion state={face} active={active} />
    <span className={styles.label} role={active ? 'status' : undefined} aria-live={active ? 'polite' : 'off'}>{activity.label}</span>
    {active && <Link href="/settings/profile#companion" className={styles.settings} aria-label="Customize companion" title="Customize companion">
      <SlidersHorizontal size={14} />
    </Link>}
  </div>;
}
