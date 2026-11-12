import { describe, expect, it } from 'vitest';
import { detectDomainKeyFromText, resolveSessionDomainKey } from '../domain-context';

describe('detectDomainKeyFromText', () => {
  it('detects HR from welcome briefing and starter prompts', () => {
    expect(
      detectDomainKeyFromText(
        'Give me a two-minute briefing on what our HR data covers — no table names — and the three best questions to ask first.',
      ),
    ).toBe('hr');
    expect(detectDomainKeyFromText('In HR, show headcount by office and type.')).toBe('hr');
    expect(detectDomainKeyFromText('What is our Darwinbox shore employee headcount?')).toBe('hr');
  });

  it('detects Crewing, Marine, Technical, QHSE, and Finance', () => {
    expect(detectDomainKeyFromText('In Crewing, check current on-signer crew count per vessel.')).toBe('crewing');
    expect(detectDomainKeyFromText('In Marine, compare estimated vs actual arrival times.')).toBe('marine');
    expect(detectDomainKeyFromText('In Technical, list all open defects per vessel.')).toBe('technical');
    expect(detectDomainKeyFromText('In QHSE, summarize findings by type and area of concern.')).toBe('qhse');
    expect(detectDomainKeyFromText('In Finance, summarize EBITDA by account type.')).toBe('finance');
  });
});

describe('resolveSessionDomainKey', () => {
  it('uses explicit domainKey when messages do not name another domain', () => {
    expect(
      resolveSessionDomainKey({
        explicitDomainKey: 'hr',
        messages: [{ role: 'user', content: 'How many active employees are in Singapore?' }],
      }),
    ).toBe('hr');
  });

  it('carries forward the domain from an earlier message in the same session', () => {
    expect(
      resolveSessionDomainKey({
        messages: [
          { role: 'user', content: 'In HR, show headcount by office and type.' },
          { role: 'assistant', content: 'Here is the headcount by office...' },
          { role: 'user', content: 'Now break that down by division.' },
        ],
      }),
    ).toBe('hr');
  });
});
