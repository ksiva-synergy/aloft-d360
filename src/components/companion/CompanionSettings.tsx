'use client';

import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { Companion } from './Companion';
import { saveCompanionPreferences, useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { COMPANION_COLORS, DEFAULT_COMPANION, type CompanionCharacter, type CompanionPersonality } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';

const CHARACTERS: { value: CompanionCharacter; label: string; detail: string }[] = [
  { value: 'nova', label: 'Nova', detail: 'The classic wobble. Friendly, curious and always ready to help.' },
  { value: 'orbit', label: 'Orbit', detail: 'The tilted wobble. Playful and attentive, with a lively personality.' },
  { value: 'lumi', label: 'Lumi', detail: 'The gentle wobble. Calm, warm and quietly reassuring.' },
  { value: 'captain', label: 'Captain', detail: 'A glossy sphere with a glowing visor. Simple, friendly, intelligent.' },
  { value: 'mochi', label: 'Mochi', detail: 'A soft white friend with tiny arms. Pure, playful and welcoming.' },
];

const PERSONALITIES: { value: CompanionPersonality; label: string; detail: string }[] = [
  { value: 'quiet', label: 'Quiet', detail: 'Still expressions and clear status text.' },
  { value: 'balanced', label: 'Balanced', detail: 'Subtle eye animations while working.' },
  { value: 'expressive', label: 'Expressive', detail: 'Animated eyes, gentle movement, and a happy finish.' },
];
const STATES: { value: CompanionState; label: string }[] = [
  { value: 'idle', label: 'Ready' }, { value: 'reading', label: 'Reading' }, { value: 'thinking', label: 'Thinking' },
  { value: 'tools', label: 'Using a tool' }, { value: 'writing', label: 'Writing' }, { value: 'success', label: 'Finished' },
  { value: 'clarification', label: 'Needs input' }, { value: 'error', label: 'Error' },
];

export function CompanionSettings() {
  const preferences = useCompanionPreferences();
  const [state, setState] = useState<CompanionState>('thinking');
  const id = useId();
  const customColor = !COMPANION_COLORS.some(c => c.value.toLowerCase() === preferences.color.toLowerCase());
  return <section id="companion" className="scroll-mt-6 rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-size-body font-semibold text-[var(--ink-1)]">Your AI companion</h2>
        <p className="mt-1 text-size-body text-[var(--ink-3)]">The familiar face beside your agent&apos;s responses. Preferences are saved in this browser.</p></div>
      <button type="button" onClick={() => saveCompanionPreferences(DEFAULT_COMPANION)} className="shrink-0 rounded-md px-2 py-1 text-size-ui text-[var(--brand-a-ink)]">Reset companion</button>
    </div>
    <div className="my-5 flex flex-wrap items-center gap-5 rounded-xl bg-[var(--surface-2)] p-4">
      <Companion state={state} size={88} />
      <div className="min-w-0 flex-1"><label htmlFor={`${id}-preview`} className="mb-2 block text-size-ui font-semibold text-[var(--ink-2)]">Try an expression</label>
        <select id={`${id}-preview`} value={state} onChange={e => setState(e.target.value as CompanionState)} className="w-full max-w-52 rounded-md border border-[var(--line-2)] bg-[var(--surface-1)] px-3 py-2 text-size-body text-[var(--ink-1)]">
          {STATES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
    </div>
    <fieldset className="mb-5"><legend className="text-size-ui font-semibold text-[var(--ink-2)]">Character</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CHARACTERS.map(item => <label key={item.value} className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-[var(--line-1)] p-3 text-center text-size-body text-[var(--ink-1)] has-[:checked]:border-[var(--brand-a)] has-[:checked]:bg-[var(--brand-a-soft)]">
          <Companion size={56} active={false} preferences={{ ...preferences, character: item.value }} />
          <span className="flex items-center gap-2 font-semibold">
            <input type="radio" name={`${id}-character`} value={item.value} checked={preferences.character === item.value} onChange={() => saveCompanionPreferences({ ...preferences, character: item.value })} className="accent-[var(--brand-a)]" />
            {item.label}
          </span>
          <span className="text-size-ui leading-5 text-[var(--ink-3)]">{item.detail}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset><legend className="text-size-ui font-semibold text-[var(--ink-2)]">Colour</legend>
      <p className="mt-1 text-size-ui text-[var(--ink-3)]">Follows the accent you pick in the account menu, or choose its own.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {COMPANION_COLORS.map(color => {
          const checked = preferences.color.toLowerCase() === color.value.toLowerCase();
          const accent = color.value === 'accent';
          return <label key={color.value} title={color.name} className={`flex cursor-pointer items-center gap-2 rounded-full text-size-ui font-semibold text-[var(--ink-2)] ring-offset-2 ring-offset-[var(--surface-1)] transition-transform hover:scale-110 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--brand-a)] ${checked ? 'ring-2 ring-[var(--ink-1)]' : 'ring-1 ring-[var(--line-2)]'} ${accent ? 'py-1 pl-1 pr-3' : ''}`}>
            <input type="radio" name={`${id}-color`} value={color.value} checked={checked} onChange={() => saveCompanionPreferences({ ...preferences, color: color.value })} className="sr-only" aria-label={color.name} />
            <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: accent ? 'var(--brand-a)' : color.value }}>
              {checked && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" strokeWidth={3} />}
            </span>
            {accent && color.name}
          </label>;
        })}
        <label title="Pick any colour" className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface-1)] transition-transform hover:scale-110 ${customColor ? 'ring-2 ring-[var(--ink-1)]' : 'ring-1 ring-[var(--line-2)]'}`}
          style={{ background: customColor ? preferences.color : 'conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e)' }}>
          <input type="color" aria-label="Custom colour" value={customColor ? preferences.color : '#7c4dff'} onChange={e => saveCompanionPreferences({ ...preferences, color: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          {customColor && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" strokeWidth={3} />}
        </label>
      </div>
    </fieldset>
    <fieldset className="mt-5"><legend className="text-size-ui font-semibold text-[var(--ink-2)]">Chat personality</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PERSONALITIES.map(item => <label key={item.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-1)] p-3 text-size-body text-[var(--ink-1)]">
          <input type="radio" name={`${id}-personality`} value={item.value} checked={preferences.personality === item.value} onChange={() => saveCompanionPreferences({ ...preferences, personality: item.value })} className="mt-1 accent-[var(--brand-a)]" />
          <span>{item.label}<span className="mt-1 block text-size-ui leading-5 text-[var(--ink-3)]">{item.detail}</span></span>
        </label>)}
      </div>
    </fieldset>
    <p className="mt-4 text-size-ui leading-5 text-[var(--ink-3)]">Colour tints the companion (Captain&apos;s eyes) and also applies on login. Chat respects reduced motion, and pauses animation off screen. Errors and activity use distinct expressions and text in every colour.</p>
  </section>;
}
