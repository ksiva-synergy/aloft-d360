// @vitest-environment jsdom
/**
 * Search knowledge step panel: choose knowledge bases (archived ones not offered, a chosen one that
 * is gone flagged), try the search for real on the chosen ones, and keep the results as the step's
 * sample response in the shape later steps read (`chunks` with `cite`).
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgePicker, TryKnowledge } from '../KnowledgeStep';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let searches: unknown[] = [];

beforeEach(() => {
  searches = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://test').pathname;
    if (path === '/api/knowledge')
      return json(200, {
        knowledgeBases: [
          { id: 'kb-sms', name: 'Company SMS', description: 'SMS manual', scope: 'org', archived: false, documents: 12 },
          { id: 'kb-old', name: 'Old circulars', description: null, scope: 'org', archived: true, documents: 3 },
        ],
      });
    if (path === '/api/knowledge/search') {
      searches.push(JSON.parse(String(init?.body)));
      return json(200, { results: [{ text: 'Tested weekly by the duty engineer.', knowledgeBaseId: 'kb-sms', documentId: 'd-1', document: 'SMS Manual.pdf', section: '4.2 Fire pumps', page: 12, kind: 'file' }] });
    }
    return json(404, {});
  });
});
afterEach(() => vi.restoreAllMocks());

function Picker({ start }: { start: string[] }) {
  const [ids, setIds] = useState(start);
  return (
    <>
      <KnowledgePicker id="kb" value={ids} onChange={setIds} />
      <output data-testid="ids">{ids.join(',')}</output>
    </>
  );
}

describe('Search knowledge step', () => {
  it('offers the knowledge bases the person may search and flags a chosen one that is gone', async () => {
    render(<Picker start={['kb-gone']} />);
    fireEvent.click(await screen.findByLabelText(/Company SMS/));
    expect(screen.queryByText('Old circulars')).toBeNull();
    expect(screen.getByText(/not found, archived or not shared/)).toBeTruthy();
    expect(screen.getByTestId('ids').textContent).toBe('kb-gone,kb-sms');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByTestId('ids').textContent).toBe('kb-sms');
  });

  it('tries the search on the chosen knowledge bases and keeps the results as the sample response', async () => {
    const onUse = vi.fn();
    render(<TryKnowledge stepId="find" query="fire pump {{inputs.vessel}}" knowledgeBaseIds={['kb-sms']} topK={5} onUseAsSample={onUse} />);
    const button = screen.getByRole('button', { name: /Try it/ });
    expect((button as HTMLButtonElement).disabled).toBe(true); // a {{ref}} has no value yet
    fireEvent.change(screen.getByLabelText(/One real search/), { target: { value: 'fire pump test interval' } });
    fireEvent.click(button);
    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByText('SMS Manual.pdf, p. 12, 4.2 Fire pumps')).toBeTruthy();
    expect(searches[0]).toEqual({ question: 'fire pump test interval', knowledgeBaseIds: ['kb-sms'], limit: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Use as sample response' }));
    await waitFor(() =>
      expect(onUse).toHaveBeenCalledWith({
        chunks: [{ text: 'Tested weekly by the duty engineer.', cite: 'SMS Manual.pdf, p. 12, 4.2 Fire pumps', document: 'SMS Manual.pdf', page: 12, section: '4.2 Fire pumps', knowledgeBaseId: 'kb-sms', documentId: 'd-1' }],
      }),
    );
  });
});
