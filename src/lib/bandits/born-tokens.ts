/**
 * BORN design tokens — colours, typography roles, geometry.
 * Extracted from the BORN Dashboard style strip (BORN Dashboard.dc.html).
 * No runtime dependencies; import freely in both client and server modules.
 */

// ── Categorical arm palette (10 hues from the BORN Dashboard style strip) ──
export const BORN_COLORS: readonly string[] = [
  '#4E79A7', // 0 steel-blue
  '#F28E2B', // 1 orange
  '#E15759', // 2 red
  '#76B7B2', // 3 teal
  '#59A14F', // 4 green
  '#EDC948', // 5 yellow
  '#B07AA1', // 6 purple
  '#FF9DA7', // 7 pink
  '#9C755F', // 8 brown
  '#BAB0AC', // 9 grey
] as const;

// ── Brand anchors ──
// GOLD/NAVY/TEAL are accents that read on both themes → kept literal.
export const GOLD   = '#FDB515' as const;
export const NAVY   = '#003262' as const;
export const TEAL   = '#5fa9ae' as const;

// ── Surface / text colours ──
// Theme-dependent tokens resolve from the `--born-*` CSS custom properties
// defined in globals.css (`:root` light + `.dark` override), so the Bandits
// dashboard flips with the global light/dark toggle. When applied to an SVG
// presentation attribute, pass these through `style={{ fill: … }}` (not the
// `fill=` attribute) so the var() resolves.
export const BASE     = 'var(--born-bg)' as const;
export const CARD_BG  = 'var(--born-surface)' as const;
export const BORDER   = 'var(--born-border)' as const;
export const TEXT_PRI = 'var(--born-text-pri)' as const;
export const TEXT_SEC = 'var(--born-text-sec)' as const;
export const TEXT_MUT = 'var(--born-text-mut)' as const;

// ── Typography roles ──
export const SERIF = "'Source Serif 4'" as const;
export const BODY  = "'Inter Tight'"    as const;
export const MONO  = "'IBM Plex Mono'"  as const;

// ── Geometry ──
export const RADIUS_MAX = 6 as const;

// ── CTSGV axis colours ──
export const CTSGV_COLORS = {
  C: '#5fa9ae', // teal
  T: '#7b8ec9', // steel
  S: '#c9a04e', // warm amber
  G: '#6abf8a', // green
  V: '#9b7ec9', // purple (always ghosted — not yet active)
} as const;

// ── CTSGV base weights (before redistribution) ──
export const BASE_WEIGHTS = { C: 0.20, T: 0.15, S: 0.25, G: 0.30, V: 0.10 } as const;

// ── Canonical model short-name map (10 arms + fallback) ──
// This is the single source of truth. Every dashboard panel that shows a model
// label must import shortName() from here rather than string-munging the raw ID.
export const MODEL_SHORT_NAMES: Record<string, string> = {
  // Azure AI Foundry
  'gpt-5.4-PBC':                               'GPT-5.4',
  'o3-pro-PBC':                                'o3-pro',
  'o3-mini':                                   'o3-mini',
  'grok-4.3-PBC':                              'Grok 4.3',
  'kimi-k2-6-PBC':                             'Kimi K2.6',
  'DeepSeek-V4-Pro':                           'DeepSeek V4',
  // AWS Bedrock
  'us.anthropic.claude-sonnet-4-6':            'Sonnet 4.6',
  'us.anthropic.claude-opus-4-6-v1':           'Opus 4.6',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'Haiku 4.5',
  'mistral.mistral-large-3-675b-instruct':     'Mistral Large 3',
};

/** Return the display short name for a model ID.
 *  Falls back to stripping common prefixes/suffixes rather than returning the raw ID. */
export function shortName(modelId: string): string {
  if (MODEL_SHORT_NAMES[modelId]) return MODEL_SHORT_NAMES[modelId];
  return modelId
    .replace(/^us\.anthropic\./, '')
    .replace(/^us\.amazon\./, '')
    .replace(/^us\.meta\./, '')
    .replace(/^qwen\./, '')
    .replace(/^mistral\./, '')
    .replace(/-PBC$/, '')
    .slice(0, 30);
}

// ── Deterministic model → colour map (10 canonical arms) ──────────────────────
// Maps each known model_id to its assigned BORN_COLORS[i] slot so that any
// component — dashboard or inline — always renders the same hue per model.
export const MODEL_COLOR_MAP: Record<string, string> = {
  'gpt-5.4-PBC':                               BORN_COLORS[0],  // steel-blue
  'o3-pro-PBC':                                BORN_COLORS[1],  // orange
  'o3-mini':                                   BORN_COLORS[2],  // red
  'grok-4.3-PBC':                              BORN_COLORS[3],  // teal
  'kimi-k2-6-PBC':                             BORN_COLORS[4],  // green
  'DeepSeek-V4-Pro':                           BORN_COLORS[5],  // yellow
  'us.anthropic.claude-sonnet-4-6':            BORN_COLORS[6],  // purple
  'us.anthropic.claude-opus-4-6-v1':           BORN_COLORS[7],  // pink
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': BORN_COLORS[8], // brown
  'mistral.mistral-large-3-675b-instruct':     BORN_COLORS[9],  // grey
};

/** Return the canonical BORN colour for a model ID.
 *  Known models get their fixed slot; unknowns get a stable hash-based fallback. */
export function modelColor(modelId: string): string {
  if (MODEL_COLOR_MAP[modelId]) return MODEL_COLOR_MAP[modelId];
  let hash = 0;
  for (let i = 0; i < modelId.length; i++) hash += modelId.charCodeAt(i);
  return BORN_COLORS[hash % BORN_COLORS.length];
}
