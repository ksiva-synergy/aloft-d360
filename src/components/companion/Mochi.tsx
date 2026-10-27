'use client';

import { useId, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionBodyColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import { useAnimateWhenVisible } from './useAnimateWhenVisible';
import styles from './Mochi.module.css';

const INK = '#0b0b1c';

function Eye({ cx, cy, side, state }: { cx: number; cy: number; side: 0 | 1; state: CompanionState }) {
  if (state === 'success') {
    return <path d={`M${cx - 7} ${cy + 2} Q${cx} ${cy - 8} ${cx + 7} ${cy + 2}`}
      fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />;
  }
  if (state === 'stopped') {
    return <path d={`M${cx - 6.5} ${cy - 1} Q${cx} ${cy + 5} ${cx + 6.5} ${cy - 1}`}
      fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />;
  }
  return <g className={styles.look}>
    <g className={`${styles.eye} ${side ? styles.eyeR : ''}`}>
      <g className={styles.pupil}>
        <ellipse cx={cx} cy={cy} rx="7.4" ry="9" fill={INK} />
        <ellipse cx={cx + 2.4} cy={cy - 3.6} rx="2.6" ry="3" fill="#ffffff" />
        <circle cx={cx - 2.6} cy={cy + 3.8} r="1.1" fill="#ffffff" opacity=".75" />
      </g>
    </g>
  </g>;
}

function Mouth({ state }: { state: CompanionState }) {
  if (state === 'success') return <path d="M54 70 Q60 70 66 70 Q65 77 60 77 Q55 77 54 70 Z" fill={INK} />;
  if (state === 'error') return <ellipse cx="60" cy="73" rx="2.6" ry="3.2" fill={INK} />;
  if (state === 'thinking' || state === 'stopped') return <path d="M57 72 L63 72" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
  return <path d="M56 70 Q60 74.5 64 70" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
}

/** Soft white companion with stubby arms; same props and states as Captain and Wobble. */
export function Mochi({ state = 'idle', active = true, size = 44, preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const [root, animate] = useAnimateWhenVisible<HTMLSpanElement>(active);
  const fill = `url(#${id}-body)`;
  return <span ref={root} aria-hidden="true" className={styles.mochi} data-captain-state={state}
    data-personality={preferences.personality} data-animate={animate}
    style={{ width: size, height: size * 110 / 120, '--mochi': companionBodyColor(preferences.color) } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        <radialGradient id={`${id}-body`} cx=".38" cy=".3" r=".78">
          <stop stopColor="#ffffff" />
          <stop offset=".6" stopColor="#f2f3f8" />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--mochi) 14%, #c3c8d6)' }} />
        </radialGradient>
      </defs>
      <ellipse className={styles.shadow} cx="60" cy="104" rx="30" ry="3.4" />
      {state === 'reading' && <g className={styles.waves} fill="none" strokeLinecap="round" strokeWidth="2.4">
        <path d="M100 20 Q106 26 104 34" /><path d="M106 12 Q115 22 112 36" />
      </g>}
      <g className={styles.body}>
        <ellipse cx="48" cy="96" rx="9" ry="5.5" fill={fill} stroke="rgba(20,20,51,.08)" />
        <ellipse cx="72" cy="96" rx="9" ry="5.5" fill={fill} stroke="rgba(20,20,51,.08)" />
        <g className={`${styles.arm} ${styles.armL}`}>
          <ellipse cx="20" cy="66" rx="6" ry="10" transform="rotate(30 20 66)" fill={fill} stroke="rgba(20,20,51,.08)" />
        </g>
        <g className={`${styles.arm} ${styles.armR}`}>
          <ellipse cx="100" cy="66" rx="6" ry="10" transform="rotate(-30 100 66)" fill={fill} stroke="rgba(20,20,51,.08)" />
        </g>
        <ellipse cx="60" cy="55" rx="41" ry="39" fill={fill} stroke="rgba(20,20,51,.08)" />
        <ellipse cx="44" cy="28" rx="13" ry="5.5" transform="rotate(-24 44 28)" fill="#ffffff" />
        <Eye cx={47} cy={57} side={0} state={state} />
        <Eye cx={73} cy={57} side={1} state={state} />
        <Mouth state={state} />
      </g>
      {state === 'thinking' && <g className={styles.dots}>
        <circle cx="100" cy="18" r="2.2" /><circle cx="107" cy="11" r="2.8" /><circle cx="115" cy="4" r="2" />
      </g>}
      {state === 'clarification' && <path className={styles.question} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"
        d="M98 12 Q98 4 105 4 Q112 4 112 11 Q112 16 106 18 L106 22 M106 28 L106 28.5" />}
      {state === 'success' && <g className={styles.sparks} fill="none" strokeLinecap="round" strokeWidth="2.6">
        <path d="M96 14 L99 6" /><path d="M104 20 L111 15" /><path d="M106 30 L114 30" />
        <path d="M24 14 L21 6" /><path d="M16 20 L9 15" />
      </g>}
    </svg>
  </span>;
}
