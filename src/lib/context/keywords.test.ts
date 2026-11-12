import { describe, expect, it } from 'vitest';
import { extractDomainKeywords, tokenizeCatalogNameQuery, tokenizeQuery } from './keywords';

describe('tokenizeCatalogNameQuery', () => {
  it('removes conversational wording but keeps the catalog object name', () => {
    expect(tokenizeCatalogNameQuery('there is a table called sire report')).toEqual(['sire', 'report']);
  });

  it('keeps the mission domain when the user asks to create an agent', () => {
    expect(tokenizeCatalogNameQuery('I would like to create agent for inspections')).toEqual(['inspections']);
  });

  it('splits underscored catalog names into searchable terms', () => {
    expect(tokenizeCatalogNameQuery('sire_report')).toEqual(['sire', 'report']);
  });

  it('preserves short domain tokens like hr and drops briefing filler', () => {
    expect(tokenizeQuery('HR employee headcount')).toContain('hr');
    expect(tokenizeCatalogNameQuery('HR data briefing')).toEqual(['hr']);
  });

  it('indexes darwin_box catalog and hr alias in extractDomainKeywords', () => {
    const kw = extractDomainKeywords({
      full_path: 'darwin_box.curated_db.employee_master',
      card: { summary: 'Employee master', grain: 'one row per employee_id', entity: 'employee' },
      columns: [],
    });
    expect(kw).toContain('darwin');
    expect(kw).toContain('box');
    expect(kw).toContain('hr');
    expect(kw).toContain('darwinbox');
  });
});
