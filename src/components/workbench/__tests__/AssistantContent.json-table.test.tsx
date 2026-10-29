// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantContent } from '@/components/workbench/StreamingMessage';

const reply = [
  'Scores are not populated.',
  '',
  '```json',
  JSON.stringify([
    { vessel_acronym: 'SOOS', sire_reference_no: '', inspection_date: '2026-10-01' },
    { vessel_acronym: 'YOSH', sire_reference_no: 'OC-19', inspection_date: '2026-10-02' },
  ], null, 2),
  '```',
].join('\n');

describe('AssistantContent tabular JSON', () => {
  it('renders a record array as a table and can switch back to JSON', () => {
    render(<AssistantContent content={reply} />);
    expect(screen.getByText('Scores are not populated.')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-data-table')).toBeInTheDocument();
    expect(screen.getByText('Vessel acronym')).toBeInTheDocument();
    expect(screen.getByText('SOOS')).toBeInTheDocument();
    expect(screen.getByText('OC-19')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-code-block')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByTestId('assistant-code-block')).toBeInTheDocument();
    expect(screen.getByText(/vessel_acronym/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByTestId('assistant-data-table')).toBeInTheDocument();
  });

  it('keeps a nested JSON object as a code block', () => {
    render(<AssistantContent content={'```json\n{"verified":{"status_code":0},"gaps":["none"]}\n```'} />);
    expect(screen.getByTestId('assistant-code-block')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-data-table')).not.toBeInTheDocument();
  });
});
