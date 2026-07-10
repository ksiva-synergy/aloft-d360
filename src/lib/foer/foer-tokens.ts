// FOER design tokens — colours, status weights, topic accent ramp.
// Mirrors born-tokens.ts structure; import freely in client and server modules.
// Gold is repurposed here as the "golden core memory" orb for HARD_RULE (not a header accent).

// ── Rule-type colour map ───────────────────────────────────────────────────────
export const RULE_TYPE_COLORS: Record<string, string> = {
  HARD_RULE:    '#FDB515', // gold  — golden core memory (largest/brightest orb)
  FAILURE_MODE: '#D9774B', // rust
  HEURISTIC:    '#5FA9AE', // teal
  SOURCE_PREF:  '#6F9DC4', // steel
  SCHEMA_MAP:   '#5E7E96', // slate
};

// ── Status luminosity weights (0..1, applied as opacity to orbs/chips) ────────
export const STATUS_OPACITY: Record<string, number> = {
  ACTIVE:     1.0,
  SUPERSEDED: 0.4,
  EXPIRED:    0.2,
};

// ── Topic accent ramp (10 desaturated categoricals — avoids gold and violet) ──
// Gold is reserved for HARD_RULE; violet is ghosted in the BORN palette.
export const TOPIC_COLORS: readonly string[] = [
  '#5FA9AE', // 0 teal
  '#6F9DC4', // 1 steel
  '#5E7E96', // 2 slate
  '#6ABF8A', // 3 green
  '#7B8EC9', // 4 blue-violet (desaturated)
  '#C9A04E', // 5 warm amber
  '#A0B87A', // 6 sage
  '#8CA9BE', // 7 light steel
  '#A8C5B0', // 8 mint
  '#9EAABD', // 9 cool grey
] as const;

export const TOPIC_ALL_KNOWLEDGE_ACCENT = '#A89B8C' as const;

// ── Brand anchors (shared with BORN) ─────────────────────────────────────────
export const GOLD = '#FDB515' as const;
export const NAVY = '#003262' as const;
export const BG_DARK = '#05090f' as const;
export const TOOLTIP_BG = '#0F2236' as const;
export const TOOLTIP_TEXT = '#F0F4F8' as const;
export const MAXWELL_GREEN = '#88B8A0' as const;

// ── Typography roles ──────────────────────────────────────────────────────────
export const SERIF = "'Source Serif 4'" as const;
export const BODY  = "'Inter Tight'"    as const;
export const MONO  = "'IBM Plex Mono'"  as const;

/** Return a stable topic accent colour by rank index. */
export function topicColor(rank: number): string {
  return TOPIC_COLORS[rank % TOPIC_COLORS.length];
}

/** Return the canonical colour for a rule type, falling back to muted text. */
export function ruleTypeColor(ruleType: string): string {
  return RULE_TYPE_COLORS[ruleType] ?? '#8a9bb5';
}
