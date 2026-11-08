'use client';

import { useId, type CSSProperties } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { companionBodyColor, type CompanionPreferences } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';
import { useAnimateWhenVisible } from './useAnimateWhenVisible';
import { COAT_BOX, type CoatShape } from './wobble-fur';
import styles from './Wobble.module.css';
import { useFurCoat } from './useFurCoat';

const INK = '#141433';

function Eye({ cx, cy, r, side, state, ids, furry }: {
  cx: number; cy: number; r: number; side: 0 | 1; state: CompanionState; ids: string; furry: boolean;
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
      {furry
        // On fur: a feathered hollow without a hard ring below the eye.
        ? <>
          <circle cx={cx} cy={cy + .6} r={r + 5} fill={`url(#${ids}-hollow)`} />
        </>
        // Smooth body: recessed socket, a soft dark rim above and a soft pale halo below.
        : <>
          <circle cx={cx} cy={cy - .6} r={r + 3.4} fill={`url(#${ids}-socket)`} />
          <circle cx={cx} cy={cy + .9} r={r + 3.6} fill={`url(#${ids}-halo)`} />
        </>}
      <g className={styles.pupil}>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${ids}-iris)`} />
        {/* body colour bouncing back off the glossy eye */}
        <ellipse cx={cx - r * .1} cy={cy + r * .55} rx={r * .6} ry={r * .28} fill={`url(#${ids}-bounce)`} />
        <ellipse cx={cx + r * .3} cy={cy - r * .36} rx={r * .22} ry={r * .19} fill="#ffffff" />
        <circle cx={cx - r * .38} cy={cy + r * .3} r={r * .1} fill="#ffffff" opacity=".7" />
        {/* Short tapered fibres seat the lower eye edge in the coat. */}
        {furry && Array.from({ length: 9 }, (_, i) => {
          const angle = Math.PI * (0.2 + i * 0.075);
          const x = cx + Math.cos(angle) * (r + 0.45);
          const y = cy + Math.sin(angle) * (r + 0.45);
          const length = 0.8 + (i % 3) * 0.25;
          const tipX = x - Math.cos(angle) * length + 0.3;
          const tipY = y - Math.sin(angle) * length;
          return <path key={i} d={`M${x - .23} ${y} Q${x} ${y - .5} ${tipX} ${tipY} Q${x + .3} ${y - .2} ${x + .23} ${y}Z`}
            style={{ fill: 'color-mix(in srgb, var(--wob) 40%, white)' }} opacity=".85" />;
        })}
      </g>
    </g>
    {state === 'error' && <path d={side
      ? `M${cx - r} ${cy - r - 7} L${cx + r} ${cy - r - 3}`
      : `M${cx - r} ${cy - r - 3} L${cx + r} ${cy - r - 7}`}
      stroke={INK} strokeWidth="2.4" strokeLinecap="round" opacity=".7" />}
  </g>;
}

export type WobbleShape = 'nova' | 'orbit' | 'lumi';

type Spot = [number, number, number];

const SHAPES: Record<WobbleShape, { body: string; gloss: Spot; eyes: [Spot, Spot] }> = {
  // Classic: asymmetric floating blob, big eyes.
  nova: {
    body: 'M16 80 C8 62 20 34 48 22 C74 11 102 22 108 48 C113 72 98 92 68 95 C42 98 22 93 16 80 Z',
    gloss: [46, 36, -24], eyes: [[49, 64, 12], [77, 60, 10.5]],
  },
  // Tilted: elongated bean leaning up-right.
  orbit: {
    body: 'M12 76 C8 58 26 40 54 30 C80 21 106 20 111 40 C116 62 98 84 68 91 C40 97 16 92 12 76 Z',
    gloss: [58, 38, -16], eyes: [[57, 64, 11.2], [83, 58, 9.8]],
  },
  // Gentle: rounder dome with a soft flat base.
  lumi: {
    body: 'M14 86 C12 52 34 22 62 22 C90 22 110 50 108 84 C107 94 96 98 60 98 C26 98 15 95 14 86 Z',
    gloss: [48, 40, -24], eyes: [[49, 66, 11], [75, 64, 10]],
  },
};

/** Fur layout per character; fixed seeds so each always grows the same coat. */
const COATS: Record<WobbleShape, CoatShape> = {
  nova: { name: 'nova', body: SHAPES.nova.body, eyes: SHAPES.nova.eyes, seed: 388 },
  orbit: { name: 'orbit', body: SHAPES.orbit.body, eyes: SHAPES.orbit.eyes, seed: 485 },
  lumi: { name: 'lumi', body: SHAPES.lumi.body, eyes: SHAPES.lumi.eyes, seed: 395 },
};

/** Soft blob companion (Nova / Orbit / Lumi); same props and states as Captain. */
export function Wobble({ state = 'idle', active = true, size = 44, shape = 'nova', preferences: override }: {
  state?: CompanionState; active?: boolean; size?: number; shape?: WobbleShape; preferences?: CompanionPreferences;
}) {
  const saved = useCompanionPreferences();
  const preferences = override ?? saved;
  const id = useId().replace(/:/g, '');
  const [root, animate] = useAnimateWhenVisible<HTMLSpanElement>(active);
  // Pastel stops: the chosen colour mixed toward white (or a deep ink for shading), with optional opacity.
  const tint = (pct: number, mix = 'white', stopOpacity = 1) =>
    ({ stopColor: `color-mix(in srgb, var(--wob) ${pct}%, ${mix})`, stopOpacity });
  const SHADE = '#20183f';
  const { body, gloss: [gx, gy, ga], eyes: [left, right] } = SHAPES[shape];
  const coat = useFurCoat(root, COATS[shape], size, preferences.color);
  const mouthX = (left[0] + right[0]) / 2, mouthY = (left[1] + right[1]) / 2 + left[2] + 1;
  return <span ref={root} aria-hidden="true" className={styles.wobble} data-captain-state={state} data-character={shape}
    data-personality={preferences.personality} data-animate={animate}
    style={{ width: size, height: size * 110 / 120, '--wob': companionBodyColor(preferences.color) } as CSSProperties}>
    <svg viewBox="0 0 120 110" focusable="false">
      <defs>
        {/* Matte "soft-touch" body: near-white key light top-left, colour deepening toward the edges. */}
        <radialGradient id={`${id}-body`} cx=".36" cy=".26" r=".9">
          <stop style={tint(3)} />
          <stop offset=".35" style={tint(16)} />
          <stop offset=".72" style={tint(40)} />
          <stop offset="1" style={tint(62)} />
        </radialGradient>
        {/* Ambient occlusion on the underside. */}
        <linearGradient id={`${id}-occl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".5" style={tint(70, SHADE, 0)} />
          <stop offset="1" style={tint(70, SHADE, .32)} />
        </linearGradient>
        {/* Bounce light along the bottom edge (reads as subsurface glow). */}
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".55" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" style={tint(18, 'white', .9)} />
        </linearGradient>
        <radialGradient id={`${id}-gloss`}>
          <stop stopColor="#ffffff" stopOpacity=".85" />
          <stop offset=".55" stopColor="#ffffff" stopOpacity=".35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop style={tint(85, SHADE, .45)} />
          <stop offset=".5" style={tint(70, 'white', .22)} />
          <stop offset="1" style={tint(60, 'white', 0)} />
        </radialGradient>
        <radialGradient id={`${id}-socket`}>
          <stop offset=".72" style={tint(80, SHADE, .45)} />
          <stop offset="1" style={tint(80, SHADE, 0)} />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset=".7" stopColor="#ffffff" />
          <stop offset=".8" stopColor="#ffffff" stopOpacity=".7" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-hollow`}>
          <stop offset=".45" style={tint(80, SHADE, .24)} />
          <stop offset=".72" style={tint(80, SHADE, .1)} />
          <stop offset="1" style={tint(80, SHADE, 0)} />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx=".4" cy=".32" r=".75">
          <stop stopColor="#3b3672" /><stop offset=".5" stopColor="#110f2c" /><stop offset="1" stopColor="#030210" />
        </radialGradient>
        <radialGradient id={`${id}-bounce`}>
          <stop style={tint(70, 'white', .4)} />
          <stop offset="1" style={tint(70, 'white', 0)} />
        </radialGradient>
        <clipPath id={`${id}-clip`}><path d={body} /></clipPath>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>
      <ellipse className={styles.shadow} cx="62" cy="103" rx="40" ry="7" fill={`url(#${id}-shadow)`} />
      {state === 'reading' && <g className={styles.waves} fill="none" strokeLinecap="round" strokeWidth="2">
        <path d="M8 52 Q3 62 8 72" /><path d="M2 48 Q-4 62 2 76" />
        <path d="M114 50 Q119 60 114 70" /><path d="M120 46 Q126 60 120 74" />
      </g>}
      <g className={styles.body}>
        {/* Smooth vector body: shown until the fur coat is painted, then fades out beneath it. */}
        <g className={styles.skin} data-hidden={coat ? '' : undefined}>
          <path d={body} fill={`url(#${id}-body)`} />
          <path d={body} fill={`url(#${id}-occl)`} />
          <g clipPath={`url(#${id}-clip)`}>
            <path d={body} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="6" filter={`url(#${id}-soft)`} />
          </g>
          <ellipse cx={gx} cy={gy} rx="24" ry="13" transform={`rotate(${ga} ${gx} ${gy})`} fill={`url(#${id}-gloss)`} />
        </g>
        {/* Fur coat (hair and lighting), painted once and shared; see wobble-fur.ts. */}
        {coat && <image className={styles.coat} href={coat.core} x={COAT_BOX.x} y={COAT_BOX.y}
          width={COAT_BOX.width} height={COAT_BOX.height} preserveAspectRatio="none" />}
        {/* Tiny mouth: the error face frowns, every other face smiles. */}
        <path d={state === 'error'
          ? `M${mouthX - 3} ${mouthY + 2.2} Q${mouthX} ${mouthY - .4} ${mouthX + 3} ${mouthY + 2.2}`
          : `M${mouthX - 3.2} ${mouthY} q1.6 2.2 3.2 0 q1.6 2.2 3.2 0`}
          fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <Eye cx={left[0]} cy={left[1]} r={left[2]} side={0} state={state} ids={id} furry={!!coat} />
        <Eye cx={right[0]} cy={right[1]} r={right[2]} side={1} state={state} ids={id} furry={!!coat} />
      </g>
      {/* Outer fringe and tuft: repeats the body's motion a beat late (so the hair trails each move) and drifts
          gently on its own. */}
      {coat && <g className={`${styles.body} ${styles.fringe}`}>
        <g className={styles.drift}>
          <image className={styles.coat} href={coat.fringe} x={COAT_BOX.x} y={COAT_BOX.y}
            width={COAT_BOX.width} height={COAT_BOX.height} preserveAspectRatio="none" />
        </g>
      </g>}
      {state === 'success' && <g className={styles.sparks} fill="none" strokeLinecap="round" strokeWidth="2.4">
        <path d="M98 14 L101 6" /><path d="M106 20 L113 15" /><path d="M108 30 L116 30" />
      </g>}
    </svg>
  </span>;
}
