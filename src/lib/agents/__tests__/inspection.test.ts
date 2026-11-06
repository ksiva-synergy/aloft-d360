import { describe, expect, it } from 'vitest';
import { messagesForViewer, parseInspection } from '../inspection';

const note = {
  sources: 'darwin_box.curated_db.employee_master',
  joins: 'employee_master.EMPLOYEE_ID = cleansed_employee_master.employee_id (assumed)',
  caveats: 'One roster row has no employment dates.',
};

describe('parseInspection', () => {
  it('keeps a note and drops an empty one', () => {
    expect(parseInspection(note)).toEqual(note);
    expect(parseInspection({ sources: '  ', joins: '', caveats: '' })).toBeNull();
    expect(parseInspection(null)).toBeNull();
  });
});

describe('messagesForViewer', () => {
  const messages = [{ id: '1', role: 'assistant' as const, content: 'Dinesh S is active.', inspection: note }];

  it('keeps the note for a platform admin and an admin', () => {
    expect(messagesForViewer(messages, 'platform_admin')[0].inspection).toEqual(note);
    expect(messagesForViewer(messages, 'admin')[0].inspection).toEqual(note);
  });

  it('drops the note for a member', () => {
    expect(messagesForViewer(messages, 'member')[0]).toEqual({ id: '1', role: 'assistant', content: 'Dinesh S is active.' });
    expect('inspection' in messagesForViewer(messages, 'readonly')[0]).toBe(false);
  });
});
