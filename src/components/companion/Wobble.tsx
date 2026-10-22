'use client';

import { useId, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionBodyColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import { useAnimateWhenVisible } from './useAnimateWhenVisible';
import styles from './Wobble.module.css';

const INK = '#141433';

function Eye({ cx, cy, r, side, state, irisId }: {
  cx: number; cy: number; r: number; side: 0 | 1; state: CompanionState; irisId: string;
}) {
  if (state === 'success') {
    return <path d={`M${cx - r} ${cy + 2} Q${cx} ${cy - r * 1.1} ${cx + r} ${cy + 2}`}
      fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />;
  }
  if (state === 'stopped') {
    return <path d={`M${cx - r * .8} ${cy} L${cx + r * .8} ${cy}`} stroke={INK} strokeWidth="3.2" strokeLinecap="round" />;
  }
  return <g className={styles.look}>
    <g className={`${styles.eye} ${side ? styles.eyeR : ''}`}>
      <circle cx={cx} cy={cy} r={r + 1.8} fill="#ffffff" opacity=".9" />
      <g className={styles.pupil}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${irisId})`} />
        <circle cx={cx + r * .32} cy={cy - r * .38} r={r * .3} fill="#ffffff" />
        <circle cx={cx - r * .35} cy={cy + r * .35} r={r * .12} fill="#ffffff" opacity=".8" />
      </g>
    </g>
    {state === 'error' && <path d={side
      ? `M${cx - r} ${cy - r - 7} L${cx + r} ${cy - r - 3}`
      : `M${cx - r} ${cy - r - 3} L${cx + r} ${cy - r - 7}`}
      stroke={INK} strokeWidth="2.4" strokeLinecap="round" opacity=".7" />}
  </g>;
}

export type WobbleShape = 'nova' | 'orbit' | 'lumi';

const SHAPES: Record<WobbleShape, { body: string; gloss: [number, number, number]; eyes: [number, number, number][] }> = {
  // Classic: asymmetric floating blob, big eyes.
  nova: {
    body: 'M16 80 C8 62 20 34 48 22 C74 11 102 22 108 48 C113 72 98 92 68 95 C42 98 22 93 16 80 Z',
    gloss: [44, 33, -22], eyes: [[46, 60, 9.5], [77, 56, 8]],
  },
  // Tilted: elongated bean leaning up-right.
  orbit: {
    body: 'M12 76 C8 58 26 40 54 30 C80 21 106 20 111 40 C116 62 98 84 68 91 C40 97 16 92 12 76 Z',
    gloss: [56, 34, -16], eyes: [[52, 62, 8.5], [80, 56, 7.5]],
  },
  // Gentle: rounder dome with a soft flat base.
  lumi: {
    body: 'M14 86 C12 52 34 22 62 22 C90 22 110 50 108 84 C107 94 96 98 60 98 C26 98 15 95 14 86 Z',
    gloss: [46, 36, -28], eyes: [[48, 64, 8], [76, 62, 7.2]],
  },
};

/** Soft blob companion (Nova / Orbit / Lumi); same props and states as Captain. */
export function Wobble({ state = 'idle', active = true, size = 44, shape = 'nova', preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; shape?: WobbleShape; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const [root, animate] = useAnimateWhenVisible<HTMLSpanElement>(active);
  const tint = (pct: number, mix = 'white') => ({ stopColor: `color-mix(in srgb, var(--wob) ${pct}%, ${mix})` });
  const { body, gloss: [gx, gy, ga], eyes: [left, right] } = SHAPES[shape];
  return <span ref={root} aria-hidden="true" className={styles.wobble} data-captain-state={state} data-character={shape}
    data-personality={preferences.personality} data-animate={animate}
    style={{ width: size, height: size * 110 / 120, '--wob': companionBodyColor(preferences.color) } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        <radialGradient id={`${id}-body`} cx=".36" cy=".28" r=".85">
          <stop style={tint(10)} />
          <stop offset=".5" style={tint(42)} />
          <stop offset="1" style={tint(82, '#2b2560')} />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx=".4" cy=".35" r=".7">
          <stop stopColor="#2c2a5c" /><stop offset="1" stopColor="#06061a" />
        </radialGradient>
      </defs>
      <ellipse className={styles.shadow} cx="62" cy="104" rx="34" ry="3.6" />
      {state === 'reading' && <g className={styles.waves} fill="none" strokeLinecap="round" strokeWidth="2">
        <path d="M8 52 Q3 62 8 72" /><path d="M2 48 Q-4 62 2 76" />
        <path d="M114 50 Q119 60 114 70" /><path d="M120 46 Q126 60 120 74" />
      </g>}
      <g className={styles.body}>
        <path d={body} fill={`url(#${id}-body)`} />
        <ellipse cx={gx} cy={gy} rx="15" ry="5.5" transform={`rotate(${ga} ${gx} ${gy})`} fill="#ffffff" opacity=".55" />
        <Eye cx={left[0]} cy={left[1]} r={left[2]} side={0} state={state} irisId={`${id}-iris`} />
        <Eye cx={right[0]} cy={right[1]} r={right[2]} side={1} state={state} irisId={`${id}-iris`} />
      </g>
      {state === 'success' && <g className={styles.sparks} fill="none" strokeLinecap="round" strokeWidth="2.4">
        <path d="M98 14 L101 6" /><path d="M106 20 L113 15" /><path d="M108 30 L116 30" />
      </g>}
    </svg>
  </span>;
}
