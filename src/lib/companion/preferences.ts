export const COMPANION_KEY = 'aloft-companion-v1';
export const COMPANION_EVENT = 'aloft-companion-change';
export type CompanionPersonality = 'quiet' | 'balanced' | 'expressive';
export interface CompanionPreferences { color: string; personality: CompanionPersonality }
export const DEFAULT_COMPANION: CompanionPreferences = { color: '#7ee8ff', personality: 'balanced' };
export const COMPANION_COLORS = [
  { name: 'Cyan', value: '#7ee8ff' }, { name: 'Violet', value: '#b9a4ff' },
  { name: 'Blue', value: '#8fb4ff' }, { name: 'Mint', value: '#8de4be' },
  { name: 'Amber', value: '#ffd18b' }, { name: 'App accent', value: 'accent' },
] as const;

export function parseCompanionPreferences(raw: string | null): CompanionPreferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      color: value && (value.color === 'accent' || /^#[\da-f]{6}$/i.test(value.color)) ? value.color : DEFAULT_COMPANION.color,
      personality: value && ['quiet', 'balanced', 'expressive'].includes(value.personality) ? value.personality : DEFAULT_COMPANION.personality,
    };
  } catch { return DEFAULT_COMPANION; }
}

/** Lift custom/accent colours against the dark visor without changing the shell. */
export function companionColor(color: string): string {
  return color === 'accent'
    ? 'color-mix(in srgb, var(--brand-a, #7ee8ff) 55%, white)'
    : `color-mix(in srgb, ${color} 85%, white)`;
}
