// @vitest-environment jsdom
/**
 * "Extract document fields" step: choose what to read, try it on one real file (the API is faked),
 * see each value with the text it was read from, and keep the result as the step's sample response.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepEditor } from '../FlowForm';
import type { Def, Step } from '../editor-model';

const capabilities = [{ id: 'document.extract', title: 'Extract document fields', fields: { connection: {}, key: {}, schema: {} } }];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function renderExtract(input: Record<string, unknown>) {
  const step: Step = { id: 'extract', type: 'tool', config: { capability: 'document.extract', input } };
  const def: Def = { name: 'x', steps: [step] };
  const onChange = vi.fn();
  const onFixture = vi.fn();
  render(<StepEditor step={step} def={def} onChange={onChange} onClose={() => {}} capabilities={capabilities} onFixture={onFixture} />);
  return { onChange, onFixture };
}

afterEach(() => vi.restoreAllMocks());

describe('try extraction', () => {
  it('reads one file and offers the result as the sample response', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/connections') return json(200, { connections: [{ id: 'c-1', name: 'Crew docs', kind: 's3', status: 'ok', mine: true }] });
      return json(200, {
        documentType: 'Certificate of Competency',
        values: { holder_name: 'JOHN SMITH', expiry_date: '2027-03-31' },
        fields: {
          holder_name: { value: 'JOHN SMITH', page: 1, evidence: 'Name: JOHN SMITH' },
          expiry_date: { value: '2027-03-31', page: 2, evidence: 'Valid until 31.03.2027' },
          issue_date: { value: null, page: null, evidence: '03/2022', issue: '"03/2022" is not a full date (YYYY-MM-DD)' },
        },
        missing: ['issue_date'],
        model: 'grok-4.7',
        pages: { sent: 2, total: 2, truncated: false },
        file: { name: 'smith.pdf' },
      });
    });
    const { onFixture } = renderExtract({ connection: 'c-1', schema: 'seafarer_certificate', key: '{{item.key}}' });
    expect((screen.getByLabelText('What to read') as HTMLSelectElement).value).toBe('seafarer_certificate');

    // A ref is not a file path, so the box starts empty.
    const path = screen.getByLabelText('File path') as HTMLInputElement;
    expect(path.value).toBe('');
    fireEvent.change(path, { target: { value: 'certs/smith.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: /Try on a file/ }));

    const table = await screen.findByRole('table', { name: 'Extracted fields' });
    expect(calls.find((c) => c.url.endsWith('/extract'))).toEqual({ url: '/api/connections/c-1/extract', body: { path: 'certs/smith.pdf', schema: 'seafarer_certificate' } });
    const expiry = within(table).getByRole('rowheader', { name: 'Expiry date' }).closest('tr')!;
    expect(expiry.textContent).toContain('2027-03-31');
    expect(expiry.textContent).toContain('“Valid until 31.03.2027” · page 2');
    expect(within(table).getByRole('rowheader', { name: 'Issue date' }).closest('tr')!.textContent).toContain('Not accepted');
    expect(within(table).getByRole('rowheader', { name: 'Certificate number' }).closest('tr')!.textContent).toContain('Not found');

    fireEvent.click(screen.getByRole('button', { name: 'Use as sample response' }));
    expect(onFixture).toHaveBeenCalledWith(expect.objectContaining({ schema: 'seafarer_certificate', values: { holder_name: 'JOHN SMITH', expiry_date: '2027-03-31' }, missing: ['issue_date'] }));
  });

  it('asks for a connection and a schema before it can try, and shows the server’s reason on failure', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/connections' ? json(200, { connections: [] }) : json(503, { error: 'Document extraction needs Grok: set XAI_API_KEY on the server' }),
    );
    const { onChange } = renderExtract({ connection: 'CHOOSE_CONNECTION', key: 'a.pdf' });
    expect(screen.getByText('Choose a connection first.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Try on a file/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What to read'), { target: { value: 'seafarer_medical' } });
    expect((onChange.mock.calls[0]![0] as Def).steps![0]!.config.input).toMatchObject({ schema: 'seafarer_medical', key: 'a.pdf' });
  });
});
