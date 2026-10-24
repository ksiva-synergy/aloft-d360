import { describe, expect, it } from 'vitest';
import { buildAppearanceVars, resolveRailHex } from '@/lib/theme/appearance';

describe('resolveRailHex', () => {
  const sage = '#E3E9DE';
  const midnight = '#0B1426';

  it('legacy light sage applies only in light mode', () => {
    const a = { accent: null, rail: sage, railLight: null, railDark: null };
    expect(resolveRailHex('light', a)).toBe(sage);
    expect(resolveRailHex('dark', a)).toBeNull();
  });

  it('legacy midnight applies only in dark mode', () => {
    const a = { accent: null, rail: midnight, railLight: null, railDark: null };
    expect(resolveRailHex('light', a)).toBeNull();
    expect(resolveRailHex('dark', a)).toBe(midnight);
  });

  it('per-mode picks override legacy rail', () => {
    const a = { accent: null, rail: sage, railLight: null, railDark: midnight };
    expect(resolveRailHex('dark', a)).toBe(midnight);
    expect(resolveRailHex('light', a)).toBe(sage);
  });
});

describe('buildAppearanceVars', () => {
  it('does not inject light sage rail vars in dark mode for legacy storage', () => {
    const vars = buildAppearanceVars({
      accent: null,
      rail: '#E3E9DE',
      railLight: null,
      railDark: null,
    }).dark;
    expect(vars['--rail-bg']).toBeUndefined();
  });
});
