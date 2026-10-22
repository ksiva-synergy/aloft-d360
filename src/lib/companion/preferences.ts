import { ACCENT_PRESETS } from '@/lib/theme/appearance';

export const COMPANION_KEY = 'aloft-companion-v2';
// v1 colours came from an older palette; only personality/character carry over.
export const LEGACY_COMPANION_KEY = 'aloft-companion-v1';
export const COMPANION_EVENT = 'aloft-companion-change';
export type CompanionPersonality = 'quiet' | 'balanced' | 'expressive';
export type CompanionCharacter = 'nova' | 'orbit' | 'lumi' | 'captain';
export const COMPANION_CHARACTERS: readonly CompanionCharacter[] = ['nova', 'orbit', 'lumi', 'captain'];
export interface CompanionPreferences { color: string; personality: CompanionPersonality; character: CompanionCharacter }
// 'accent' follows the app accent colour chosen in the account menu.
export const DEFAULT_COMPANION: CompanionPreferences = { color: 'accent', personality: 'balanced', character: 'nova' };
export const COMPANION_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Match app accent', value: 'accent' },
  ...ACCENT_PRESETS.map(p => ({ name: p.name, value: p.hex })),
];

export function parseCompanionPreferences(raw: string | null): CompanionPreferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      color: value && (value.color === 'accent' || /^#[\da-f]{6}$/i.test(value.color)) ? value.color : DEFAULT_COMPANION.color,
      personality: value && ['quiet', 'balanced', 'expressive'].includes(value.personality) ? value.personality : DEFAULT_COMPANION.personality,
      character: value && COMPANION_CHARACTERS.includes(value.character) ? value.character
        : value?.character === 'wobble' ? 'nova' : DEFAULT_COMPANION.character,
    };
  } catch { return DEFAULT_COMPANION; }
}

/** Lift custom/accent colours against the dark visor without changing the shell. */
export function companionColor(color: string): string {
  return color === 'accent'
    ? 'color-mix(in srgb, var(--brand-a, #7ee8ff) 55%, white)'
    : `color-mix(in srgb, ${color} 85%, white)`;
}

/** Wobble's body tint: the raw colour, so pastel presets stay soft. */
export function companionBodyColor(color: string): string {
  return color === 'accent' ? 'var(--brand-a, #8b7bff)' : color;
}
