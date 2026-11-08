'use client';

import { useId, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionBodyColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import { useAnimateWhenVisible } from './useAnimateWhenVisible';
import styles from './Mochi.module.css';
import { useFurCoat } from './useFurCoat';
import { COAT_BOX, type CoatShape } from './wobble-fur';

const INK = '#0b0b1c';
const BODY = 'M18 65 C18 46 26 30 40 26 C40 18 47 12 55 14 C52 18 53 22 58 23 C78 19 91 32 97 49 C100 57 105 66 102 77 C99 92 82 97 60 96 C35 98 16 89 18 65Z';
const COAT: CoatShape = { name: 'mochi', body: BODY, eyes: [[43, 61, 8.2], [77, 59, 8.2]], seed: 716 };

function Eye({ cx, cy, side, state, id, furry }: { cx: number; cy: number; side: 0 | 1; state: CompanionState; id: string; furry: boolean }) {
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
      <ellipse cx={cx} cy={cy - .6} rx="10" ry="11.6" fill={`url(#${id}-socket)`} opacity={furry ? .5 : 1} />
      {!furry && <ellipse cx={cx} cy={cy + 1} rx="10" ry="11.6" fill={`url(#${id}-halo)`} />}
      <g className={styles.pupil}>
        <ellipse cx={cx} cy={cy} rx="6.6" ry="8.2" fill={`url(#${id}-gloss)`} />
        <ellipse cx={cx} cy={cy + 4.5} rx="4.2" ry="2.1" fill={`url(#${id}-bounce)`} />
        <ellipse cx={cx - 1.6} cy={cy - 3.1} rx="2.1" ry="2.5" fill="#ffffff" />
        <circle cx={cx - 2.6} cy={cy + 3.8} r="1.1" fill="#ffffff" opacity=".75" />
      </g>
    </g>
  </g>;
}

/** Soft furry marshmallow companion; shared activity and motion preferences. */
export function Mochi({ state = 'idle', active = true, size = 44, preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const [root, animate] = useAnimateWhenVisible<HTMLSpanElement>(active);
  const coat = useFurCoat(root, COAT, size, preferences.color, '--mochi');
  const tint = (percent: number, mix = 'white', stopOpacity = 1) => ({
    stopColor: `color-mix(in srgb, var(--mochi) ${percent}%, ${mix})`, stopOpacity,
  });
  return <span ref={root} aria-hidden="true" className={styles.mochi} data-captain-state={state}
    data-personality={preferences.personality} data-animate={animate}
    style={{ width: size, height: size * 110 / 120, '--mochi': companionBodyColor(preferences.color) } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        <radialGradient id={`${id}-body`} cx=".36" cy=".26" r=".9">
          <stop style={tint(3)} />
          <stop offset=".35" style={tint(16)} />
          <stop offset=".72" style={tint(40)} />
          <stop offset="1" style={tint(62)} />
        </radialGradient>
        <linearGradient id={`${id}-occl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".5" style={tint(70, '#34313b', 0)} />
          <stop offset="1" style={tint(70, '#34313b', .32)} />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".55" stopColor="white" stopOpacity="0" />
          <stop offset="1" style={tint(18, 'white', .9)} />
        </linearGradient>
        <radialGradient id={`${id}-socket`}>
          <stop offset=".65" style={tint(80, '#34313b', .45)} />
          <stop offset="1" style={tint(80, '#34313b', 0)} />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset=".65" stopColor="white" stopOpacity=".7" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-bounce`}>
          <stop style={tint(70, 'white', .4)} />
          <stop offset="1" style={tint(70, 'white', 0)} />
        </radialGradient>
        <clipPath id={`${id}-clip`}><path d={BODY} /></clipPath>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <radialGradient id={`${id}-paw`} cx="32%" cy="18%" r="85%">
          <stop style={tint(5)} />
          <stop offset=".5" style={tint(28)} />
          <stop offset="1" style={tint(65, '#615b60')} />
        </radialGradient>
        <radialGradient id={`${id}-gloss`} cx="35%" cy="20%" r="85%">
          <stop stopColor="#555068" /><stop offset=".45" stopColor="#252338" />
          <stop offset="1" stopColor="#0b0b1c" />
        </radialGradient>
        <radialGradient id={`${id}-light`}>
          <stop stopColor="#fff" stopOpacity=".85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-ground`}>
          <stop stopColor="#39304e" stopOpacity=".3" />
          <stop offset="1" stopColor="#39304e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className={styles.shadow} cx="60" cy="104" rx="34" ry="5" fill={`url(#${id}-ground)`} />
      {state === 'reading' && <g className={styles.waves} fill="none" strokeLinecap="round" strokeWidth="2.4">
        <path d="M100 20 Q106 26 104 34" /><path d="M106 12 Q115 22 112 36" />
      </g>}
      <g className={styles.body}>
        <ellipse cx="48" cy="96" rx="9" ry="5.5" fill={`url(#${id}-paw)`} stroke="rgba(77,62,101,.12)" />
        <ellipse cx="72" cy="96" rx="9" ry="5.5" fill={`url(#${id}-paw)`} stroke="rgba(77,62,101,.12)" />
        <g className={`${styles.arm} ${styles.armL}`}>
          <ellipse cx="20" cy="66" rx="6" ry="10" transform="rotate(30 20 66)" fill={`url(#${id}-paw)`} stroke="rgba(77,62,101,.12)" />
        </g>
        <g className={`${styles.arm} ${styles.armR}`}>
          <ellipse cx="100" cy="66" rx="6" ry="10" transform="rotate(-30 100 66)" fill={`url(#${id}-paw)`} stroke="rgba(77,62,101,.12)" />
        </g>
        <g className={styles.skin} data-hidden={coat ? '' : undefined}>
        <path d={BODY} fill={`url(#${id}-body)`} />
        <path d={BODY} fill={`url(#${id}-occl)`} />
        <g clipPath={`url(#${id}-clip)`}>
          <path d={BODY} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="6" filter={`url(#${id}-soft)`} />
          <ellipse cx="41" cy="40" rx="24" ry="16" transform="rotate(-30 41 40)" fill={`url(#${id}-light)`} />
        </g>
        </g>
        {coat && <>
          <image href={coat.core} x={COAT_BOX.x} y={COAT_BOX.y} width={COAT_BOX.width} height={COAT_BOX.height} />
          <image href={coat.fringe} x={COAT_BOX.x} y={COAT_BOX.y} width={COAT_BOX.width} height={COAT_BOX.height} />
        </>}
        <g className={styles.face}>
        <Eye cx={43} cy={61} side={0} state={state} id={id} furry={!!coat} />
        <Eye cx={77} cy={59} side={1} state={state} id={id} furry={!!coat} />
        <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity=".7">
          {state === 'clarification' || state === 'thinking'
            ? <><path d="M37 47 Q41 44 46 46" /><path d="M72 43 Q77 39 82 42" /></>
            : state === 'error'
              ? <><path d="M37 48 L46 45" /><path d="M72 44 L81 48" /></>
              : <path d="M73 45 Q77 43 81 45" opacity=".45" />}
        </g>
        </g>
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
