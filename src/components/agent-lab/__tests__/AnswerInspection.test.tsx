// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnswerInspection } from '../AnswerInspection';

const note = {
  sources: 'darwin_box.curated_db.employee_master',
  joins: 'Assumed on employee id.',
  caveats: 'One row has no employment dates.',
};

describe('AnswerInspection', () => {
  it('stays closed until Inspect is opened', () => {
    render(<AnswerInspection inspection={note} />);
    expect(screen.queryByText(note.sources)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(screen.getByText('Sources')).toBeTruthy();
    expect(screen.getByText(note.sources)).toBeTruthy();
    expect(screen.getByText(note.joins)).toBeTruthy();
    expect(screen.getByText(note.caveats)).toBeTruthy();
  });
});
