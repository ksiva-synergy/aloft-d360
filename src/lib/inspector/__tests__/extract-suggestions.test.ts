import { describe, expect, it } from 'vitest';
import { extractSuggestionsFromText, splitFollowUps } from '../extract-suggestions';

describe('extractSuggestionsFromText', () => {
  it('extracts prose "I can X, Y, or Z" follow-ups from the end of a reply', () => {
    const reply = `Costing spreads that same headcount: **Ship Management 1,249**, **Marine Services 704**, **Crewing & Training 670**, **Corporate Functions 370**, **JV – Ship Management 193**. Corporate Functions appears only as a costing line — nobody is paid on it.

Three people have both lines blank.

I can break the 645 mismatches by office or department, list the 339 Ship Management people costed to Corporate Functions, or show the same split by employment type (permanent vs contract).`;

    expect(extractSuggestionsFromText(reply)).toEqual([
      'Break the 645 mismatches by office or department',
      'List the 339 Ship Management people costed to Corporate Functions',
      'Show the same split by employment type (permanent vs contract)',
    ]);
  });

  it('extracts two-clause "I can next X, or Y" prose offers', () => {
    const reply = `The large vessels are clustered near the top.

I can next break the open overdue jobs by equipment criticality, or pull the vessel with the most overdue critical jobs.`;

    expect(extractSuggestionsFromText(reply)).toEqual([
      'Break the open overdue jobs by equipment criticality',
      'Pull the vessel with the most overdue critical jobs',
    ]);
  });

  it('extracts trailing markdown bullet suggestions', () => {
    const reply = `The other 38 due today are in the Results table.

- Which of the 48 due today already have a relief named?
- Break the 2,811 by vessel for one fleet only
- List the 1,556 still on board past their contract end`;

    expect(extractSuggestionsFromText(reply)).toEqual([
      'Which of the 48 due today already have a relief named?',
      'Break the 2,811 by vessel for one fleet only',
      'List the 1,556 still on board past their contract end',
    ]);
  });

  it('does not mistake earlier body bullets for trailing suggestions when prose follows without an offer', () => {
    const reply = `Key facts:
- 1,249 in Ship Management
- 704 in Marine Services

All records are from the latest batch.`;

    expect(extractSuggestionsFromText(reply)).toEqual([]);
  });
});

describe('splitFollowUps', () => {
  it('moves trailing question bullets into pills and out of the reply', () => {
    const reply = `SRL-4 has 563 + 245 rows, and 449 extra rows mean some people appear more than once.

- Split SRL-4 by office country so we can see where middle management actually sits?
- Show contribution level (TSI vs MSI vs trainee) against job level for the same file?
- Compare category mix on the current active roster (3,340) with this older rank file?`;

    const { body, items } = splitFollowUps(reply);
    expect(items).toHaveLength(3);
    expect(items[0]).toBe('Split SRL-4 by office country so we can see where middle management actually sits?');
    expect(body).toBe('SRL-4 has 563 + 245 rows, and 449 extra rows mean some people appear more than once.');
  });

  it('also drops a lead-in line such as "Next questions:"', () => {
    const reply = `Total is 1,249.

Next questions:
- Break the 1,249 by vessel
- List the 12 overdue contracts`;
    expect(splitFollowUps(reply)).toEqual({
      body: 'Total is 1,249.',
      items: ['Break the 1,249 by vessel', 'List the 12 overdue contracts'],
    });
  });

  it('drops a closing "I can ..." offer sentence but keeps the rest of the paragraph', () => {
    const reply = `There are 645 mismatches. I can break the 645 mismatches by office or department, or list the 339 Ship Management people costed to Corporate Functions.`;
    const { body, items } = splitFollowUps(reply);
    expect(items).toEqual([
      'Break the 645 mismatches by office or department',
      'List the 339 Ship Management people costed to Corporate Functions',
    ]);
    expect(body).toBe('There are 645 mismatches.');
  });

  it('keeps closing bullets that are answer content, not follow-ups', () => {
    const reply = `Headcount by division:
- 1,249 in Ship Management
- 704 in Marine Services`;
    expect(splitFollowUps(reply).body).toBe(reply);
  });

  it('leaves the reply alone when there are no follow-ups', () => {
    const reply = 'All records are from the latest batch.';
    expect(splitFollowUps(reply)).toEqual({ body: reply, items: [] });
  });
});

describe('answer bullets followed by follow-up bullets', () => {
  const reply = `## P&L summary

- Revenue is about **4.24 billion**, and gross profit holds at about **2.80 billion** after cost of sales of about −506 million.
- Employee benefits cover **948** vessels; every other account covers **951**.

- Break the same accounts out by year (2023, 2024, 2025)?
- Split EBITDA before and after central cost by service line (Tech, Crew, Marine)?
- Show which owner groups or vessel types drive the largest employee-benefit and overhead costs?`;

  const followUps = [
    'Break the same accounts out by year (2023, 2024, 2025)?',
    'Split EBITDA before and after central cost by service line (Tech, Crew, Marine)?',
    'Show which owner groups or vessel types drive the largest employee-benefit and overhead costs?',
  ];

  it('takes only the last list as follow-ups', () => {
    expect(extractSuggestionsFromText(reply)).toEqual(followUps);
  });

  it('removes the follow-ups from the reply and keeps the answer bullets', () => {
    const { body, items } = splitFollowUps(reply);
    expect(items).toEqual(followUps);
    expect(body).toContain('Employee benefits cover **948** vessels');
    expect(body).not.toContain('Break the same accounts');
  });

  it('ignores answer bullets before a "Next questions:" lead-in', () => {
    const withLead = reply.replace('\n\n- Break', '\n\nNext questions:\n- Break');
    expect(extractSuggestionsFromText(withLead)).toEqual(followUps);
    expect(splitFollowUps(withLead).body).not.toContain('Next questions');
  });
});
