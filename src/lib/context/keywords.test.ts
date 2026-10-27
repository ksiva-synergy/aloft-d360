import { describe, expect, it } from 'vitest';
import { tokenizeCatalogNameQuery } from './keywords';

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
});
