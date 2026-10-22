/**
 * User-chosen appearance: an accent color and an (optional) sidebar color.
 *
 * Everything the user picks is turned into the design-system CSS variables that the
 * app already uses (--brand-a*, --rail-*), with contrast guarantees so any pick stays
 * readable. The per-mode defaults live in globals.css (terracotta/sage in light, sapphire in dark); a saved choice is applied as
 * inline variables on <html>, so removing them restores the defaults.
 */

export const APPEARANCE_KEY = 'aloft-appearance';

export interface Appearance {
  /** Accent color as #rrggbb, or null for the default. */
  accent: string | null;
  /** Sidebar color as #rrggbb, or null for the default. */
  rail: string | null;
}

type Vars = Record<string, string>;
export interface AppearanceVars { light: Vars; dark: Vars }

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Terracotta', hex: '#A8481F' },
  { name: 'Sapphire', hex: '#1F5FD6' },
  { name: 'Steel',    hex: '#5B8DB8' },
  { name: 'Teal',     hex: '#0F9488' },
  { name: 'Emerald',  hex: '#16A34A' },
  { name: 'Violet',   hex: '#7C4DFF' },
  { name: 'Rose',     hex: '#E0457B' },
  { name: 'Amber',    hex: '#D97706' },
  { name: 'Slate',    hex: '#64748B' },
];

export const RAIL_PRESETS: { name: string; hex: string }[] = [
  { name: 'Sage',     hex: '#E3E9DE' },
  { name: 'Mist',     hex: '#E6EAF2' },
  { name: 'Midnight', hex: '#0B1426' },
  { name: 'Graphite', hex: '#16171A' },
  { name: 'Forest',   hex: '#10241C' },
  { name: 'Plum',     hex: '#1C1230' },
  { name: 'Ink',      hex: '#0A0A0A' },
];

// ── Color math ───────────────────────────────────────────────────────────────

type RGB = [number, number, number];
type HSL = [number, number, number];

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function toRgb(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function withLightness(hex: string, l: number): string {
  const [h, s] = rgbToHsl(toRgb(hex));
  return toHex(hslToRgb([h, s, Math.max(0, Math.min(1, l))]));
}

/** Move lightness in `dir` (-1 darker, +1 lighter) until `fg` reaches `min` contrast on `bg`. */
function shiftUntil(fg: string, bg: string, min: number, dir: 1 | -1): string {
  let [h, s, l] = rgbToHsl(toRgb(fg));
  let out = fg;
  for (let i = 0; i < 60 && contrast(out, bg) < min; i++) {
    l += dir * 0.015;
    if (l <= 0 || l >= 1) break;
    out = toHex(hslToRgb([h, s, l]));
  }
  return out;
}

function mix(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i] * (1 - t) + y[i] * t) as RGB);
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Variables ────────────────────────────────────────────────────────────────

const DARK_SURFACE = "#1A1B1D";

/** The defaults in globals.css, per mode. */
export const MODE_DEFAULTS = {
  light: { accent: "#A8481F", rail: "#E3E9DE" }, // Sage Studio
  dark:  { accent: "#1F5FD6", rail: "#0B1426" }, // Data 360 Night, sapphire
} as const;

type Mode = "light" | "dark";

function buildForMode(mode: Mode, { accent, rail }: Appearance): Vars {
  const vars: Vars = {};
  const baseAccent = isHex(accent) ? accent : MODE_DEFAULTS[mode].accent;

  if (isHex(accent)) {
    // Solid brand color: always carries white text at AA.
    const brand = shiftUntil(accent, "#FFFFFF", 4.5, -1);
    vars["--brand-a"] = brand;
    vars["--brand-a-2"] = withLightness(brand, Math.min(0.72, rgbToHsl(toRgb(brand))[2] + 0.1));
    if (mode === "light") {
      const soft = mix(brand, "#FFFFFF", 0.9);
      vars["--brand-a-soft"] = soft;
      vars["--brand-a-ink"] = shiftUntil(brand, soft, 5.5, -1);
    } else {
      vars["--brand-a-soft"] = rgba(brand, 0.2);
      vars["--brand-a-ink"] = shiftUntil(accent, DARK_SURFACE, 7, 1);
    }
  }

  const railBg = isHex(rail) ? rail : MODE_DEFAULTS[mode].rail;
  const railDark = luminance(railBg) < 0.2;

  if (isHex(rail)) {
    const top = railDark ? mix(rail, "#FFFFFF", 0.06) : mix(rail, "#FFFFFF", 0.35);
    vars["--rail-bg"] = rail;
    vars["--rail-bg-top"] = top;
    if (railDark) {
      vars["--rail-ink-strong"] = "#FFFFFF";
      vars["--rail-ink"] = mix(rail, "#FFFFFF", 0.78);
      vars["--rail-muted"] = shiftUntil(mix(rail, "#FFFFFF", 0.5), rail, 5.2, 1);
      vars["--rail-line"] = "rgba(255,255,255,.10)";
      vars["--rail-hover"] = "rgba(255,255,255,.06)";
      vars["--rail-active"] = "rgba(255,255,255,.12)";
      vars["--rail-shadow"] = "rgba(8,12,24,.85)";
      vars["--rail-glow"] = "1";
    } else {
      vars["--rail-ink-strong"] = mix(rail, "#000000", 0.88);
      vars["--rail-ink"] = mix(rail, "#000000", 0.78);
      vars["--rail-muted"] = shiftUntil(mix(rail, "#000000", 0.55), rail, 5, -1);
      vars["--rail-line"] = "rgba(0,0,0,.12)";
      vars["--rail-hover"] = "rgba(0,0,0,.06)";
      vars["--rail-active"] = "rgba(255,255,255,.8)";
      vars["--rail-shadow"] = "rgba(0,0,0,.35)";
      vars["--rail-glow"] = "0";
    }
  }

  // Accent used on the sidebar itself (focus rings, markers) must read on its background.
  if (isHex(accent) || isHex(rail)) {
    vars["--rail-accent"] = railDark
      ? shiftUntil(baseAccent, railBg, 7, 1)
      : shiftUntil(baseAccent, railBg, 4.5, -1);
  }
  return vars;
}

/** Only the variables the user has changed; everything else keeps the globals.css default. */
export function buildAppearanceVars(a: Appearance): AppearanceVars {
  return { light: buildForMode("light", a), dark: buildForMode("dark", a) };
}

// ── Storage / apply ──────────────────────────────────────────────────────────

interface Stored extends Appearance { vars: AppearanceVars }

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return { accent: null, rail: null };
    const p = JSON.parse(raw) as Partial<Appearance>;
    return { accent: isHex(p.accent) ? p.accent : null, rail: isHex(p.rail) ? p.rail : null };
  } catch {
    return { accent: null, rail: null };
  }
}

const ALL_VARS = [
  '--rail-bg', '--rail-bg-top', '--rail-accent', '--rail-ink', '--rail-ink-strong', '--rail-muted',
  '--rail-line', '--rail-hover', '--rail-active', '--rail-shadow', '--rail-glow',
  '--brand-a', '--brand-a-2', '--brand-a-soft', '--brand-a-ink',
];

/** Apply to <html> for the current light/dark mode; null/null clears back to the defaults. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  // Clear first so switching mode (or resetting one of the two colors) leaves no stale values.
  ALL_VARS.forEach((v) => root.style.removeProperty(v));
  if (!a.accent && !a.rail) return;
  const vars = buildAppearanceVars(a)[root.classList.contains('dark') ? 'dark' : 'light'];
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function saveAppearance(a: Appearance): void {
  try {
    if (!a.accent && !a.rail) {
      localStorage.removeItem(APPEARANCE_KEY);
    } else {
      const stored: Stored = { ...a, vars: buildAppearanceVars(a) };
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(stored));
    }
  } catch { /* storage unavailable */ }
  applyAppearance(a);
  window.dispatchEvent(new Event('aloft:appearance'));
}

/**
 * Tiny blocking script for <head>: applies the saved variables before first paint so a
 * custom accent doesn't flash the default. Mirrors applyAppearance() using the
 * precomputed variables stored by saveAppearance().
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('${APPEARANCE_KEY}')||'null');if(!s||!s.vars)return;var r=document.documentElement,v=s.vars[r.classList.contains('dark')?'dark':'light'];for(var k in v)r.style.setProperty(k,v[k])}catch(e){}})();`;
