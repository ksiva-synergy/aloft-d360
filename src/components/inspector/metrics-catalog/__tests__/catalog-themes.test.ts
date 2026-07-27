/**
 * Theme derivation rule. A passing test proves the rule RUNS and buckets
 * sensibly on a representative fixture — it does NOT substitute for the
 * build-gate live eyeball over real labels (the flat curated_db.deffect_list.*
 * namespace means a real run could still skew toward Uncategorized). We assert
 * the layered precedence (override → keyword → structured → Uncategorized) and
 * bound the Uncategorized share on a domain-shaped fixture.
 */
import { describe, it, expect } from 'vitest';
import { deriveTheme, THEME_OVERRIDES, UNCATEGORIZED, type ThemeInput } from '../catalog-themes';

describe('deriveTheme — precedence', () => {
  it('keyword match wins for domain labels', () => {
    expect(deriveTheme({ rowKey: 'measure:1', kind: 'measure', label: 'Deficiency count' }).theme).toBe('Inspections & Defects');
    expect(deriveTheme({ rowKey: 'measure:2', kind: 'measure', label: 'EEXI rating' }).theme).toBe('Regulatory & Efficiency');
    expect(deriveTheme({ rowKey: 'dimension:3', kind: 'dimension', label: 'Registered owner' }).theme).toBe('Ownership & Registration');
  });

  it('matches keywords in synonyms too', () => {
    expect(deriveTheme({ rowKey: 'measure:4', kind: 'measure', label: 'Foo', synonyms: ['detention rate'] }).theme).toBe('Inspections & Defects');
  });

  it('falls back to structured signal when no keyword hits', () => {
    expect(deriveTheme({ rowKey: 'dimension:5', kind: 'dimension', label: 'xzq', dimensionType: 'temporal' }).theme).toBe('Time & Dates');
    expect(deriveTheme({ rowKey: 'dimension:6', kind: 'dimension', label: 'xzq', dimensionType: 'numeric' }).theme).toBe('Measures & Quantities');
    expect(deriveTheme({ rowKey: 'measure:7', kind: 'measure', label: 'xzq', metricType: 'ratio' }).theme).toBe('Regulatory & Efficiency');
    expect(deriveTheme({ rowKey: 'measure:8', kind: 'measure', label: 'xzq', metricType: 'simple' }).theme).toBe('Measures & Quantities');
    expect(deriveTheme({ rowKey: 'entity:9', kind: 'entity', label: 'xzq' }).theme).toBe('Entities & Tables');
  });

  it('Uncategorized only for a truly unmatched categorical dimension', () => {
    const r = deriveTheme({ rowKey: 'dimension:10', kind: 'dimension', label: 'xzq123', dimensionType: 'categorical' });
    expect(r.theme).toBe(UNCATEGORIZED);
    expect(r.overridden).toBe(false);
  });

  it('override wins over everything and is flagged', () => {
    THEME_OVERRIDES['dimension:override-me'] = 'Commercial';
    try {
      const r = deriveTheme({ rowKey: 'dimension:override-me', kind: 'dimension', label: 'Deficiency count' });
      expect(r.theme).toBe('Commercial');
      expect(r.overridden).toBe(true);
    } finally {
      delete THEME_OVERRIDES['dimension:override-me'];
    }
  });
});

describe('deriveTheme — Uncategorized share bound (fixture)', () => {
  // Domain-shaped fixture resembling a deficiency/inspection estate.
  const fixture: ThemeInput[] = [
    { rowKey: 'm:1', kind: 'measure', label: 'Deficiency count' },
    { rowKey: 'm:2', kind: 'measure', label: 'Detention rate', metricType: 'ratio' },
    { rowKey: 'm:3', kind: 'measure', label: 'CII score' },
    { rowKey: 'm:4', kind: 'measure', label: 'Total inspections' },
    { rowKey: 'd:1', kind: 'dimension', label: 'Flag state' },
    { rowKey: 'd:2', kind: 'dimension', label: 'Vessel type' },
    { rowKey: 'd:3', kind: 'dimension', label: 'Inspection date', dimensionType: 'temporal' },
    { rowKey: 'd:4', kind: 'dimension', label: 'Registered owner' },
    { rowKey: 'd:5', kind: 'dimension', label: 'Charter cost', dimensionType: 'numeric' },
    { rowKey: 'e:1', kind: 'entity', label: 'Deficiency list' },
  ];

  it('keeps Uncategorized well under half', () => {
    const uncat = fixture.filter((f) => deriveTheme(f).theme === UNCATEGORIZED).length;
    expect(uncat / fixture.length).toBeLessThan(0.5);
  });
});
