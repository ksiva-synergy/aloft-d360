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

  it('shows a single JSON object as a record and can switch back to JSON', () => {
    render(<AssistantContent content={'```json\n{"verified":{"status_code":0},"gaps":["no OCIMF reference"]}\n```'} />);
    expect(screen.getByTestId('assistant-data-record')).toBeInTheDocument();
    expect(screen.getByText('Status code')).toBeInTheDocument();
    expect(screen.getByText('Gaps')).toBeInTheDocument();
    expect(screen.getByText('no OCIMF reference')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-code-block')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByTestId('assistant-code-block')).toBeInTheDocument();
  });

  it('keeps a one-field JSON object as a code block', () => {
    render(<AssistantContent content={'```json\n{"only":"one"}\n```'} />);
    expect(screen.getByTestId('assistant-code-block')).toBeInTheDocument();
  });

  it('shows a nested list of objects as a small table in the expanded row', () => {
    const rows = ['PIBA', 'YOSH'].map((vessel) => ({
      vessel_acronym: vessel,
      status: vessel === 'PIBA' ? '10' : '220',
      findings: [
        { nc_code: 'NC-1', description: 'Mooring line chafed beyond the allowed wear limit', closed: false },
        { nc_code: 'NC-2', description: 'Fire damper on the engine room vent not closing fully', closed: true },
      ],
    }));
    render(<AssistantContent content={'```json\n' + JSON.stringify(rows) + '\n```'} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show details' })[0]);
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('Nc code')).toBeInTheDocument();
    expect(screen.getByText('NC-2')).toBeInTheDocument();
    expect(screen.getByText('Mooring line chafed beyond the allowed wear limit')).toBeInTheDocument();
  });

  it('renders tabular JSON in any fenced language tag', () => {
    const rows = [
      { vessel_acronym: 'SOOS', sire_reference_no: '', inspection_date: '2026-10-01' },
    ];
    render(<AssistantContent content={'```javascript\n' + JSON.stringify(rows) + '\n```'} />);
    expect(screen.getByTestId('assistant-data-table')).toBeInTheDocument();
  });

  it('renders SIRE-style nested record arrays as a table inside a json fence', () => {
    const sireReply = [
      'October 2026 SIRE window.',
      '',
      '```json',
      JSON.stringify([
        {
          vessel_acronym: 'PIBA',
          sire_reference_no: '',
          inspection_dates: { from: '2026-10-19', to: null },
          status: '10',
          readiness: 'escalate',
          nc_summary: { number_of_nc: '0', target_date: '2027-01-18' },
          evidence: ['inspection_audit_by=SIRE'],
          gaps: ['sire_reference_no blank'],
          recommended_actions: ['Escalate'],
        },
      ], null, 2),
      '```',
    ].join('\n');
    render(<AssistantContent content={sireReply} />);
    expect(screen.getByTestId('assistant-data-table')).toBeInTheDocument();
    expect(screen.getByText('PIBA')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-code-block')).not.toBeInTheDocument();

    // Field names inside gap text render as their own <code>, so match on the whole list item.
    const gapItem = (_: string, el: Element | null) => el?.tagName === 'LI' && el.textContent === 'sire_reference_no blank';
    expect(screen.queryByText(gapItem)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText(gapItem)).toBeInTheDocument();
    expect(screen.getByText('sire_reference_no').tagName).toBe('CODE');
    expect(screen.getByText('Recommended actions')).toBeInTheDocument();
  });
});
