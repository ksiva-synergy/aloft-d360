/**
 * Theme derivation for the Metrics catalog — pure, unit-tested, no I/O.
 *
 * WHY this rule (settled after code-read): the live estate's `full_path` is
 * uniformly `curated_db.deffect_list.*`, so the schema/table prefix segregates
 * nothing. Betting the whole coverage story on label keywords alone is fragile.
 * So the rule is layered, structured-signal-aware, and steward-OVERRIDABLE:
 *
 *   1. explicit override for this row (steward-curated) — always wins;
 *   2. domain keyword match on the label/synonyms (the human-meaningful axis);
 *   3. structured-field signal — `dimension_type` (temporal/numeric) or
 *      `metric_type` (ratio/derived/cumulative) — guaranteed to exist and to
 *      group *something* even when labels are noise;
 *   4. `Uncategorized` — the honest fallback, never a silent mis-bucket.
 *
 * The order puts human-domain meaning first but falls back to structure so a
 * flat namespace can't collapse everything into one theme. Coverage/facets are
 * only as good as this rule — a passing test proves it *runs*; a live eyeball
 * pass over the derived distribution (and the `Uncategorized` share) is a build
 * gate, not something a fixture test can substitute for.
 *
 * ── BUILD GATE #2 — theme-sanity criterion (must pass on the LIVE estate) ─────
 * Run this rule over the real governed model's ~692 defs (curated_db.deffect_list.*)
 * and the distribution PASSES iff ALL hold. This is the pass/fail the /run smoke
 * test exists to check — it is fixed HERE, before the run, on purpose:
 *   1. `Uncategorized` share < 30% of all defs. (Fixture test asserts a looser
 *      <50% floor; real domain labels should clear a keyword or structured
 *      signal far more often.)
 *   2. No single theme holds > 50% of defs. A bucket swallowing half means the
 *      rule isn't discriminating (keyword over-match, or everything falling
 *      through to one structured fallback like "Measures & Quantities").
 *   3. >= 4 themes are non-empty. The surface promises a faceted coverage story;
 *      1–2 live themes is a flat list wearing a coverage hat.
 *   4. The domain split resembles the mock's intent: a substantial
 *      "Inspections & Defects" bucket, plus recognizable Ownership & Registration,
 *      Vessel Characteristics, and Time & Dates — not one generic catch-all.
 *   5. Spot-check ~10 rows in each top theme: labels are plausibly about that
 *      theme (no obvious mis-bucket an override should fix).
 * On failure: tune KEYWORD_GROUPS / the structured fallback, or add
 * THEME_OVERRIDES for the mis-bucketed rows — do NOT relax the criterion.
 */

import type { DefKind } from './catalog-types';

export const UNCATEGORIZED = 'Uncategorized';

/**
 * Canonical theme buckets. Order here is the canonical display order for
 * coverage/facets (Uncategorized always trails).
 */
export const THEMES = [
  'Inspections & Defects',
  'Regulatory & Efficiency',
  'Ownership & Registration',
  'Vessel Characteristics',
  'Commercial',
  'Time & Dates',
  'Measures & Quantities',
  'Entities & Tables',
  UNCATEGORIZED,
] as const;

export type Theme = (typeof THEMES)[number] | string;

/**
 * Domain keyword → theme. First matching group (in this order) wins. Tokens are
 * matched case-insensitively as substrings of the label/synonyms. Steward-tune
 * this map as the vocabulary grows; it is intentionally in code (reviewable),
 * not a hidden config.
 */
const KEYWORD_GROUPS: Array<{ theme: Theme; tokens: string[] }> = [
  {
    theme: 'Inspections & Defects',
    tokens: ['defect', 'deficiency', 'inspection', 'psc', 'detention', 'audit', 'finding', 'nonconformity', 'survey'],
  },
  {
    theme: 'Regulatory & Efficiency',
    tokens: ['eexi', 'cii', 'emission', 'co2', 'carbon', 'fuel', 'efficiency', 'regulat', 'compliance', 'marpol', 'sox', 'nox'],
  },
  {
    theme: 'Ownership & Registration',
    tokens: ['owner', 'operator', 'manager', 'company', 'registration', 'registered', 'flag', 'class', 'society', 'imo'],
  },
  {
    theme: 'Vessel Characteristics',
    tokens: ['vessel', 'ship', 'tanker', 'bulker', 'dwt', 'tonnage', 'gross', 'beam', 'draft', 'length', 'type', 'built', 'yard'],
  },
  {
    theme: 'Commercial',
    tokens: ['cost', 'price', 'usd', 'amount', 'revenue', 'freight', 'charter', 'rate', 'expense', 'budget'],
  },
];

/**
 * Steward override map, keyed by `rowKey` (`${kind}:${id}`). Curated exceptions
 * that the derivation rule gets wrong. Kept small and explicit. Extend here
 * rather than contorting the keyword map for a single row.
 */
export const THEME_OVERRIDES: Record<string, Theme> = {};

export interface ThemeInput {
  rowKey: string;
  kind: DefKind;
  label: string;
  synonyms?: string[];
  dimensionType?: string;
  metricType?: string;
}

export interface ThemeResult {
  theme: Theme;
  overridden: boolean;
}

function keywordTheme(haystack: string): Theme | null {
  const h = haystack.toLowerCase();
  for (const group of KEYWORD_GROUPS) {
    if (group.tokens.some((t) => h.includes(t))) return group.theme;
  }
  return null;
}

function structuredTheme(input: ThemeInput): Theme | null {
  if (input.kind === 'dimension') {
    const dt = (input.dimensionType ?? '').toLowerCase();
    if (dt === 'temporal' || dt === 'date' || dt === 'time') return 'Time & Dates';
    if (dt === 'numeric' || dt === 'number' || dt === 'quantitative') return 'Measures & Quantities';
  }
  if (input.kind === 'measure') {
    const mt = (input.metricType ?? '').toLowerCase();
    if (mt === 'ratio' || mt === 'derived' || mt === 'cumulative') return 'Regulatory & Efficiency';
    // simple measures without a keyword hit are still quantities
    return 'Measures & Quantities';
  }
  if (input.kind === 'entity') return 'Entities & Tables';
  return null;
}

/**
 * Derive the theme for one definition. Pure: same input → same output.
 */
export function deriveTheme(input: ThemeInput): ThemeResult {
  const override = THEME_OVERRIDES[input.rowKey];
  if (override) return { theme: override, overridden: true };

  const haystack = [input.label, ...(input.synonyms ?? [])].join(' ');
  const byKeyword = keywordTheme(haystack);
  if (byKeyword) return { theme: byKeyword, overridden: false };

  const byStructure = structuredTheme(input);
  if (byStructure) return { theme: byStructure, overridden: false };

  return { theme: UNCATEGORIZED, overridden: false };
}

/** Canonical sort index for a theme (Uncategorized last, unknowns after known). */
export function themeOrder(theme: Theme): number {
  const i = (THEMES as readonly string[]).indexOf(theme);
  return i === -1 ? THEMES.length - 0.5 : i; // unknown before Uncategorized's slot end
}
