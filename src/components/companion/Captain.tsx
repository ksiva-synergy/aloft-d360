'use client';

import { useId, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionBodyColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import { useAnimateWhenVisible } from './useAnimateWhenVisible';
import styles from './Captain.module.css';

const VISOR = '#070914';

/** Glowing crescent eye; the visor-coloured cut-out gives the "C" shape. */
function Eye({ cx, cy, rx, ry, side, state }: {
  cx: number; cy: number; rx: number; ry: number; side: 0 | 1; state: CompanionState;
}) {
  if (state === 'success') {
    return <path d={`M${cx - rx} ${cy + 3} Q${cx} ${cy - ry * 1.2} ${cx + rx} ${cy + 3}`}
      fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />;
  }
  if (state === 'stopped') {
    return <path d={`M${cx - rx} ${cy} L${cx + rx} ${cy}`} stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />;
  }
  return <g className={`${styles.eye} ${side ? styles.eyeR : ''}`}>
    <g className={styles.pupil}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="currentColor" />
      <ellipse cx={cx + rx * .55} cy={cy + ry * .12} rx={rx * .42} ry={ry * .5} fill={VISOR} />
    </g>
    {state === 'error' && <path fill={VISOR} d={side
      ? `M${cx - rx - 2} ${cy - ry - 2} L${cx + rx + 2} ${cy - ry - 2} L${cx + rx + 2} ${cy - ry * .2} Z`
      : `M${cx - rx - 2} ${cy - ry - 2} L${cx + rx + 2} ${cy - ry - 2} L${cx - rx - 2} ${cy - ry * .2} Z`} />}
  </g>;
}

/** Glossy sphere companion with a glowing visor; no canvas or per-frame React work. */
export function Captain({ state = 'idle', active = true, size = 44, preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const [root, animate] = useAnimateWhenVisible<HTMLSpanElement>(active);
  const tint = (pct: number, mix = 'white') => ({ stopColor: `color-mix(in srgb, var(--cap) ${pct}%, ${mix})` });
  return <span ref={root} aria-hidden="true" className={styles.captain} data-captain-state={state}
    data-personality={preferences.personality} data-animate={animate}
    style={{ width: size, height: size * 110 / 120, '--cap': companionBodyColor(preferences.color), color: 'color-mix(in srgb, var(--cap) 45%, white)' } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        <radialGradient id={`${id}-shell`} cx=".38" cy=".3" r=".8">
          <stop style={tint(15)} /><stop offset=".55" style={tint(62)} /><stop offset="1" style={tint(80, '#141833')} />
        </radialGradient>
        <linearGradient id={`${id}-glass`} x2="0" y2="1"><stop stopColor="#1a1f38" /><stop offset=".5" stopColor={VISOR} /></linearGradient>
      </defs>
      <ellipse className={styles.pad} cx="60" cy="103" rx="30" ry="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {state === 'reading' && <g className={styles.waves} fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2">
        <path d="M6 40 Q0 52 6 64" /><path d="M-1 35 Q-8 52 -1 69" />
        <path d="M114 40 Q120 52 114 64" /><path d="M121 35 Q128 52 121 69" />
      </g>}
      {state === 'tools' && <ellipse className={styles.orbit} cx="60" cy="54" rx="58" ry="15" transform="rotate(-14 60 54)"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength="100" strokeDasharray="38 62" />}
      {state === 'writing' && <circle className={styles.progress} cx="60" cy="50" r="50" fill="none" stroke="currentColor"
        strokeWidth="2.6" strokeLinecap="round" pathLength="100" strokeDasharray="22 78" />}
      <g className={styles.head}>
        <circle cx="60" cy="50" r="44" fill={`url(#${id}-shell)`} />
        <ellipse className={styles.ear} cx="19" cy="52" rx="5" ry="15" style={{ fill: 'color-mix(in srgb, var(--cap) 25%, white)' }} stroke="currentColor" strokeWidth="2.4" />
        <ellipse cx="44" cy="17" rx="16" ry="4" fill="#ffffff" opacity=".9" />
        <rect x="27" y="28" width="74" height="44" rx="22" fill={`url(#${id}-glass)`} />
        <path d="M36 33 Q60 27 88 32" fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" opacity=".18" />
        <g className={styles.leds}>
          <Eye cx={52} cy={50} rx={9.5} ry={10.5} side={0} state={state} />
          <Eye cx={83} cy={50} rx={6.5} ry={10.5} side={1} state={state} />
        </g>
      </g>
      {state === 'thinking' && <g className={styles.dots} fill="currentColor">
        <circle cx="104" cy="14" r="2.2" /><circle cx="111" cy="8" r="2.8" /><circle cx="119" cy="2" r="2" />
      </g>}
      {state === 'success' && <g className={styles.burst} fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4">
        <path d="M60 0 L60 -7" /><path d="M86 6 L91 0" /><path d="M34 6 L29 0" /><path d="M104 20 L111 16" /><path d="M16 20 L9 16" />
      </g>}
    </svg>
  </span>;
}
