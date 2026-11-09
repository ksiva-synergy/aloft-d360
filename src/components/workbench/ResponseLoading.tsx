'use client';

import { Companion } from '@/components/companion/Companion';
import { companionActivity, type ActivityInput } from '@/lib/companion/activity';
import styles from './ResponseLoading.module.css';

const FRIENDLY_MESSAGES: Record<string, string> = {
  'Reading your message': 'Let me look into that…',
  'Thinking it through': 'Thinking through your request…',
  'Analyzing your question': 'Working out the best way to answer…',
  'Reviewing the data catalog': 'Looking through the available data…',
  'Searching available data': 'Finding the right data for your question…',
  'Querying data': 'Checking the data for your answer…',
  'Preparing export': 'Getting your export ready…',
  'Writing a response': 'Putting your answer together…',
};

/** One live status, driven by actual activity rather than a simulated percentage. */
export function ResponseLoading({ active = true, ...input }: ActivityInput & { active?: boolean }) {
  const activity = companionActivity(input);
  const writing = input.activity === 'writing' && activity.state !== 'tools';
  const label = writing ? 'Putting your answer together…' : (FRIENDLY_MESSAGES[activity.label] ?? activity.label);
  return (
    <div className={styles.panel} data-active={active} data-phase={writing ? 'writing' : activity.state}>
      <div className={styles.avatar} aria-hidden="true">
        <Companion state={writing ? 'writing' : activity.state} active={active} size={40} />
      </div>
      <span className={styles.title} role="status" aria-live="polite" aria-atomic="true">
        <span key={label} className={styles.label}>{label}</span>
      </span>
      <span className={styles.wave} aria-hidden="true"><i /><i /><i /><i /><i /></span>
    </div>
  );
}
