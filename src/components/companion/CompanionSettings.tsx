'use client';

import { useId, useState } from 'react';
import { Captain } from './Captain';
import { saveCompanionPreferences, useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { COMPANION_COLORS, DEFAULT_COMPANION, type CompanionPersonality } from '@/lib/companion/preferences';
import type { CompanionState } from '@/lib/companion/activity';

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
  return <section id="companion" className="scroll-mt-6 rounded-card border border-[var(--line-1)] bg-[var(--surface-1)] p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-sm font-bold text-[var(--ink-1)]">Captain, your AI companion</h2>
        <p className="mt-1 text-sm text-[var(--ink-3)]">The familiar face beside your agent&apos;s responses. Preferences are saved in this browser.</p></div>
      <button type="button" onClick={() => saveCompanionPreferences(DEFAULT_COMPANION)} className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--brand-a-ink)]">Reset companion</button>
    </div>
    <div className="my-5 flex flex-wrap items-center gap-5 rounded-xl bg-[var(--surface-2)] p-4">
      <Captain state={state} size={88} />
      <div className="min-w-0 flex-1"><label htmlFor={`${id}-preview`} className="mb-2 block text-xs font-semibold text-[var(--ink-2)]">Try an expression</label>
        <select id={`${id}-preview`} value={state} onChange={e => setState(e.target.value as CompanionState)} className="w-full max-w-52 rounded-md border border-[var(--line-2)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--ink-1)]">
          {STATES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
    </div>
    <fieldset><legend className="text-xs font-semibold text-[var(--ink-2)]">Eye colour</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {COMPANION_COLORS.map(color => <label key={color.value} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--line-1)] px-2.5 py-2 text-xs text-[var(--ink-2)]">
          <input type="radio" name={`${id}-color`} value={color.value} checked={preferences.color === color.value} onChange={() => saveCompanionPreferences({ ...preferences, color: color.value })} className="accent-[var(--brand-a)]" />
          <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: color.value === 'accent' ? 'var(--brand-a)' : color.value }} />{color.name}
        </label>)}
      </div>
      <label className="mt-3 flex items-center gap-3 text-xs text-[var(--ink-3)]">Custom eye colour
        <input type="color" aria-label="Custom eye colour" value={preferences.color === 'accent' ? DEFAULT_COMPANION.color : preferences.color} onChange={e => saveCompanionPreferences({ ...preferences, color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-[var(--line-2)] bg-transparent" />
      </label>
    </fieldset>
    <fieldset className="mt-5"><legend className="text-xs font-semibold text-[var(--ink-2)]">Chat personality</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PERSONALITIES.map(item => <label key={item.value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-1)] p-3 text-sm text-[var(--ink-1)]">
          <input type="radio" name={`${id}-personality`} value={item.value} checked={preferences.personality === item.value} onChange={() => saveCompanionPreferences({ ...preferences, personality: item.value })} className="mt-1 accent-[var(--brand-a)]" />
          <span>{item.label}<span className="mt-1 block text-xs leading-5 text-[var(--ink-3)]">{item.detail}</span></span>
        </label>)}
      </div>
    </fieldset>
    <p className="mt-4 text-xs leading-5 text-[var(--ink-3)]">Eye colour also applies on login. Chat respects reduced motion, and pauses animation off screen. Errors and activity use distinct expressions and text in every colour.</p>
  </section>;
}
