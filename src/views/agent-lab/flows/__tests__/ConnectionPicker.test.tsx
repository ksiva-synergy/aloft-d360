// @vitest-environment jsdom
/**
 * Step editor, connection picker: an operation that takes a `connection` offers the user's own
 * connections and those shared with them (by name, stored as the id); other operations do not.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { chooseSelectValue, openSelect, selectListbox, selectValue } from '@/test/form-select';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepEditor } from '../FlowForm';
import type { Def, Step } from '../editor-model';

const capabilities = [
  { id: 'object_store.list', title: 'List stored documents', fields: { connection: { binding: 'literal' }, prefix: { binding: 'data' } } },
  { id: 'notify.message', title: 'Send a team message', fields: { channel: { binding: 'literal' } } },
];

function renderTool(capability: string, input: Record<string, unknown> = {}) {
  const step: Step = { id: 'list_docs', type: 'tool', config: { capability, input } };
  const def: Def = { name: 'x', steps: [step] };
  const onChange = vi.fn();
  render(<StepEditor step={step} def={def} onChange={onChange} onClose={() => {}} capabilities={capabilities} onFixture={() => {}} />);
  return onChange;
}

afterEach(() => vi.restoreAllMocks());

describe('connection picker', () => {
  it('lists own and shared connections and stores the chosen id in the step input', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          connections: [
            { id: 'c-mine', name: 'My invoices', kind: 's3', status: 'ok', mine: true },
            { id: 'c-team', name: 'Team docs', kind: 'sharepoint', status: 'untested', mine: false, ownerName: 'Ana Owner' },
          ],
        }),
        { status: 200 },
      ),
    );
    const onChange = renderTool('object_store.list', { prefix: 'inv/' });
    await screen.findByLabelText('Connection');
    openSelect('Connection');
    const menu = selectListbox();
    expect(within(menu).getByRole('option', { name: 'My invoices' })).toBeTruthy();
    expect(within(menu).getByRole('group', { name: 'Shared with you' })).toBeTruthy();
    expect(within(menu).getByRole('option', { name: 'Team docs (not tested) · Ana Owner' })).toBeTruthy();

    chooseSelectValue('Connection', 'c-team');
    const next = onChange.mock.calls[0]![0] as Def;
    expect(next.steps![0]!.config.input).toEqual({ prefix: 'inv/', connection: 'c-team' });
    expect(screen.getByRole('link', { name: /Manage connections/ }).getAttribute('href')).toBe('/agent-staging/connections');
  });

  it('keeps a connection id the user cannot use visible instead of silently dropping it', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ connections: [] }), { status: 200 }));
    renderTool('object_store.list', { connection: 'c-gone' });
    await screen.findByText('You have no connections yet.');
    expect(selectValue('Connection')).toBe('c-gone');
    openSelect('Connection');
    expect(within(selectListbox()).getByRole('option', { name: 'c-gone (not available to you)' })).toBeTruthy();
  });

  it('offers only shared connections, not "add one", to someone without Connections access', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ connections: [{ id: 'c-team', name: 'Team docs', kind: 's3', status: 'ok', mine: false }], canCreate: false }), { status: 200 }),
    );
    renderTool('object_store.list');
    await screen.findByText(/Pick a connection shared with you\. Adding one needs Connections access/);
    expect(screen.queryByRole('button', { name: /Enter bucket and credentials/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Manage connections/ })).toBeNull();
  });

  it('is not shown for operations without a connection', () => {
    const fetch = vi.spyOn(global, 'fetch');
    renderTool('notify.message', { channel: 'ops' });
    expect(screen.queryByLabelText('Connection')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
