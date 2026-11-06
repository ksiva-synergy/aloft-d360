// @vitest-environment jsdom
/**
 * "Extract document fields" with the user's own fields: switch to "My own fields…", name a field
 * in plain words (the key is derived), pick its type, and try it on a file with that list.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { chooseSelectValue } from '@/test/form-select';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepEditor } from '../FlowForm';
import { fieldKey } from '../ExtractFieldsEditor';
import type { Def, Step } from '../editor-model';

const capabilities = [{ id: 'document.extract', title: 'Extract document fields', fields: { connection: {}, key: {}, schema: {}, fields: {} } }];

/** Keeps the definition in state so each edit re-renders, as the real page does. */
function Harness({ initial, onDef }: { initial: Record<string, unknown>; onDef: (d: Def) => void }) {
  const [def, setDef] = useState<Def>({ name: 'x', steps: [{ id: 'read_report', type: 'tool', config: { capability: 'document.extract', input: initial } }] });
  return (
    <StepEditor
      step={def.steps![0] as Step}
      def={def}
      onChange={(d) => {
        setDef(d);
        onDef(d);
      }}
      onClose={() => {}}
      capabilities={capabilities}
      onFixture={() => {}}
    />
  );
}

afterEach(() => vi.restoreAllMocks());

describe('own fields', () => {
  it('derives a reference key from the name a person types', () => {
    expect(fieldKey('Expiry date')).toBe('expiry_date');
    expect(fieldKey('  Total (USD) ')).toBe('total_usd');
    expect(fieldKey('2nd officer')).toBe('f_2nd_officer');
    expect(fieldKey('***')).toBe('');
  });

  it('builds a field list in the step and tries it on a file', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(input) === '/api/connections') return new Response(JSON.stringify({ connections: [] }), { status: 200 });
      return new Response(JSON.stringify({ documentType: 'report', values: {}, fields: {}, missing: [], model: 'grok-4.7', pages: { sent: 1, total: 1, truncated: false }, file: { name: 'a.pdf' } }), { status: 200 });
    });
    let def: Def | undefined;
    render(<Harness initial={{ connection: 'c-1', key: 'reports/a.pdf', schema: 'seafarer_certificate' }} onDef={(d) => (def = d)} />);

    await screen.findByLabelText('What to read');
    chooseSelectValue('What to read', '__own_fields');
    expect(def!.steps![0]!.config.input).toEqual({ connection: 'c-1', key: 'reports/a.pdf', fields: [{ key: '', label: '', type: 'text', description: '' }] });
    expect(screen.getByText('Finish the field list first.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Field 1 name'), { target: { value: 'Inspection date' } });
    chooseSelectValue('Field 1 type', 'date');
    fireEvent.change(screen.getByLabelText('Field 1 description'), { target: { value: 'Date of the inspection' } });
    expect(screen.getByText('values.inspection_date')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add field/ }));
    fireEvent.change(screen.getByLabelText('Field 2 name'), { target: { value: 'Deficiencies' } });
    chooseSelectValue('Field 2 type', 'number');
    fireEvent.change(screen.getByLabelText('Field 2 description'), { target: { value: 'Number of deficiencies' } });

    expect(def!.steps![0]!.config.input).toEqual({
      connection: 'c-1',
      key: 'reports/a.pdf',
      fields: [
        { key: 'inspection_date', label: 'Inspection date', type: 'date', description: 'Date of the inspection' },
        { key: 'deficiencies', label: 'Deficiencies', type: 'number', description: 'Number of deficiencies' },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /Try on a file/ }));
    await screen.findByRole('table', { name: 'Extracted fields' });
    expect(calls.find((c) => c.url.endsWith('/extract'))!.body).toEqual({ path: 'reports/a.pdf', fields: (def!.steps![0]!.config.input as { fields: unknown }).fields });

    fireEvent.click(screen.getByRole('button', { name: 'Remove field Deficiencies' }));
    expect((def!.steps![0]!.config.input as { fields: unknown[] }).fields).toHaveLength(1);
  });

  it('shows what is wrong with the list, e.g. the same name twice', () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ connections: [] }), { status: 200 }));
    render(
      <Harness
        initial={{ connection: 'c-1', key: 'a.pdf', fields: [{ key: 'date', label: 'Date', type: 'date', description: 'x' }, { key: 'date', label: 'Date', type: 'date', description: 'y' }] }}
        onDef={() => {}}
      />,
    );
    expect(screen.getByText('field 2: "date" is used twice')).toBeTruthy();
  });
});
