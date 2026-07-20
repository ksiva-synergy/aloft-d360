import {
  classifyTerm,
  fieldMatchesTerm,
  extractTerms,
  normalizeTerm,
  type ResolvableField,
} from '../intent-resolve';

// ── Helpers ───────────────────────────────────────────────────────────────────
function field(partial: Partial<ResolvableField> & { id: string }): ResolvableField {
  return {
    label: partial.id,
    description: null,
    status: 'governed',
    kind: 'measure',
    synonyms: [],
    ...partial,
  };
}

describe('normalizeTerm', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTerm('  Accident   Count ')).toBe('accident count');
  });
});

describe('fieldMatchesTerm', () => {
  it('matches on exact label (case-insensitive)', () => {
    expect(fieldMatchesTerm(field({ id: 'm1', label: 'Accident Count' }), 'accident count')).toBe(true);
  });
  it('matches on containment either direction', () => {
    expect(fieldMatchesTerm(field({ id: 'm1', label: 'Accident Count' }), 'accident')).toBe(true);
    expect(fieldMatchesTerm(field({ id: 'm1', label: 'Accident' }), 'accident count')).toBe(true);
  });
  it('matches on synonyms', () => {
    expect(fieldMatchesTerm(field({ id: 'm1', label: 'Incident Rate', synonyms: ['accident rate'] }), 'accident rate')).toBe(true);
  });
  it('does not match unrelated terms', () => {
    expect(fieldMatchesTerm(field({ id: 'm1', label: 'Fuel Cost' }), 'accident')).toBe(false);
  });
});

describe('classifyTerm — the four states', () => {
  it('matched: exactly one governed field → chosenId set', () => {
    const d = classifyTerm('accidents', [field({ id: 'm1', label: 'Accident count', status: 'governed' })]);
    expect(d.resolution).toBe('matched');
    expect(d.chosenId).toBe('m1');
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0]).toMatchObject({ id: 'm1', label: 'Accident count' });
  });

  it('ambiguous: multiple governed fields → chooser, no chosenId', () => {
    const d = classifyTerm('rate', [
      field({ id: 'm1', label: 'Accident rate', status: 'governed' }),
      field({ id: 'm2', label: 'Inspection rate', status: 'governed' }),
    ]);
    expect(d.resolution).toBe('ambiguous');
    expect(d.chosenId).toBeUndefined();
    expect(d.candidates.map((c) => c.id).sort()).toEqual(['m1', 'm2']);
  });

  it('not_governed: term matches a real but non-governed (candidate) field', () => {
    const d = classifyTerm('near miss', [
      field({ id: 'd9', label: 'Near miss category', status: 'candidate', kind: 'dimension' }),
    ]);
    expect(d.resolution).toBe('not_governed');
    expect(d.candidates).toHaveLength(1);
    expect(d.candidates[0].id).toBe('d9');
  });

  it('not_governed wins only when there is NO governed match (governed takes precedence)', () => {
    const d = classifyTerm('rate', [
      field({ id: 'm1', label: 'Accident rate', status: 'governed' }),
      field({ id: 'm2', label: 'Draft rate', status: 'candidate' }),
    ]);
    // A governed match exists → resolved via governed, candidate ignored here.
    expect(d.resolution).toBe('matched');
    expect(d.chosenId).toBe('m1');
  });

  it('unrecognized: no match anywhere, and NOT flagged capped by default', () => {
    const d = classifyTerm('sasquatch', []);
    expect(d.resolution).toBe('unrecognized');
    expect(d.candidates).toHaveLength(0);
    expect(d.cappedByTopK).toBeUndefined();
  });
});

describe('classifyTerm — top-K cap vs true absence (the load-bearing distinction)', () => {
  it('a capped-but-possibly-real term is flagged, never a hard unrecognized', () => {
    const capped = classifyTerm('obscure metric', [], { embeddingTruncated: true });
    expect(capped.resolution).toBe('unrecognized');
    expect(capped.cappedByTopK).toBe(true);

    const trulyAbsent = classifyTerm('obscure metric', [], { embeddingTruncated: false });
    expect(trulyAbsent.cappedByTopK).toBeUndefined();

    // The two must be distinguishable — a capped match must not look identical
    // to a genuine miss.
    expect(!!capped.cappedByTopK).not.toBe(!!trulyAbsent.cappedByTopK);
  });
});

describe('extractTerms', () => {
  it('splits a topic on connective stopwords, dropping them as delimiters', () => {
    const terms = extractTerms('Which vessels and root causes matter this year?');
    // "and"/"this" delimit; content phrases survive.
    expect(terms).toContain('vessels');
    expect(terms).toContain('year');
    expect(terms.some((t) => t.includes('root causes'))).toBe(true);
    expect(terms).not.toContain('which');
    expect(terms).not.toContain('and');
  });

  it('dedups repeated terms preserving order', () => {
    const terms = extractTerms('accidents by vessel and accidents by crew');
    expect(terms.filter((t) => t === 'accidents')).toHaveLength(1);
  });
});
