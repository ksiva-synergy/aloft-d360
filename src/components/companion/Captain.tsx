'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import styles from './Captain.module.css';

const RING = ['3,1', '4,1', '5,2', '5,3', '5,4', '4,5', '3,5', '2,5', '1,4', '1,3', '1,2', '2,1'];
const HAPPY = ['1,4', '2,3', '3,2', '4,3', '5,4'];
const QUESTION = ['2,1', '3,1', '4,1', '5,2', '4,3', '3,4', '3,6'];
const CONCERNED = ['1,2', '2,2', '3,3', '4,3', '5,3'];

function LedEye({ side, state }: { side: number; state: CompanionState }) {
  return <g className={styles.eye}>
    {Array.from({ length: 49 }, (_, index) => {
      const col = index % 7, row = Math.floor(index / 7), cell = `${col},${row}`;
      let lit = col >= 2 && col <= 4 && row >= 2 && row <= 4 || col === 3 && (row === 1 || row === 5);
      let animation = '';
      let delay = 0;
      if (state === 'success') lit = HAPPY.includes(cell);
      if (state === 'clarification' && side === 1) lit = QUESTION.includes(cell);
      if (state === 'error') lit = CONCERNED.includes(`${side ? 6 - col : col},${row}`);
      if (state === 'stopped') lit = row === 3 && col >= 1 && col <= 5;
      if (state === 'reading') lit = col >= 2 && col <= 4 && row >= 3 && row <= 5;
      if (state === 'thinking') { lit = row >= 2 && row <= 4 && col >= 1 && col <= 5; animation = styles.signal; delay = -(col + side * 4) * .15; }
      if (state === 'tools') { lit = RING.includes(cell); animation = styles.tool; delay = -(RING.indexOf(cell) + side * 6) * .1; }
      if (state === 'writing' && lit) { animation = styles.writing; delay = -side * .6; }
      return <g key={cell}>
        <circle cx={45 + side * 30 - 10.8 + col * 3.6} cy={43.2 + row * 3.6} r="1.3" fill="#ffffff" opacity=".07" />
        {lit && <circle className={animation} style={{ animationDelay: `${delay}s` }} cx={45 + side * 30 - 10.8 + col * 3.6} cy={43.2 + row * 3.6} r="1.3" fill="currentColor" />}
      </g>;
    })}
  </g>;
}

/** The login robot's silhouette, sized for chat; no canvas or per-frame React work. */
export function Captain({ state = 'idle', active = true, size = 44, preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    if (!active) return;
    const sync = () => setForeground(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)) : null;
    if (root.current) observer?.observe(root.current);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [active]);
  return <span ref={root} aria-hidden="true" className={styles.captain} data-captain-state={state}
    data-personality={preferences.personality} data-animate={active && visible && foreground}
    style={{ width: size, height: size * 110 / 120, color: companionColor(preferences.color) } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        <linearGradient id={`${id}-shell`} x2="0" y2="1"><stop stopColor="#ffffff" /><stop offset="1" stopColor="#dfe5f5" /></linearGradient>
        <linearGradient id={`${id}-glass`} x2="1" y2="1"><stop stopColor="#1b2142" /><stop offset="1" stopColor="#0a0d1c" /></linearGradient>
      </defs>
      <g className={styles.head}>
        <rect x="5" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
        <rect x="106" y="44" width="9" height="22" rx="4.5" fill="#cfd7ee" />
        <rect x="10" y="14" width="100" height="84" rx="38" fill={`url(#${id}-shell)`} />
        <ellipse cx="42" cy="22" rx="16" ry="3.5" fill="#ffffff" opacity=".9" />
        <rect x="22" y="31" width="76" height="46" rx="21" fill={`url(#${id}-glass)`} />
        <g className={styles.leds}><LedEye side={0} state={state} /><LedEye side={1} state={state} /></g>
      </g>
    </svg>
  </span>;
}
