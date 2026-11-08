// @vitest-environment jsdom
/**
 * Runs panel: Run now is offered only for a saved, published automation; a click sends the typed
 * inputs with an Idempotency-Key and opens the finished run; past runs list and open step by step.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RunsPanel from '../RunsPanel';
import type { Def } from '../editor-model';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const def: Def = {
  name: 'Summarise',
  inputs: [{ name: 'topic', type: 'string', required: true }],
  steps: [
    { id: 'ask', type: 'agent', name: 'Ask the analyst', config: { prompt: 'x' } },
    { id: 'save', type: 'output', config: { kind: 'save', title: 't', content: 'c' } },
  ],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const run = (over: Record<string, unknown> = {}) => ({ id: 'r1', status: 'succeeded', error: null, triggeredBy: 'me', totalTokens: 120, costUsd: 0.01, startedAt: '2026-11-08T10:00:00Z', finishedAt: '2026-11-08T10:00:03Z', createdAt: '2026-11-08T10:00:00Z', ...over });
const detail = (over: Record<string, unknown> = {}) => ({
  ...run(over),
  steps: [
    { stepId: 'ask', status: 'succeeded', attempts: 1, output: { text: 'All good' }, error: null, startedAt: null, finishedAt: null },
    { stepId: 'save', status: 'failed', attempts: 2, error: 'disk full', startedAt: null, finishedAt: null },
  ],
});

function api(opts: { runs?: unknown[]; startStatus?: number; startBody?: unknown } = {}) {
  const calls: { method: string; path: string; headers?: Record<string, string>; body?: any }[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input), 'http://test').pathname;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'POST') return json(opts.startStatus ?? 201, opts.startBody ?? { run: run() });
    if (path.endsWith('/runs')) return json(200, { runs: opts.runs ?? [] });
    return json(200, { run: detail() });
  });
  return calls;
}

describe('RunsPanel', () => {
  it('runs a published automation with its inputs and shows the steps of the finished run', async () => {
    const calls = api();
    render(<RunsPanel flowId="f1" def={def} status="active" dirty={false} onClose={() => {}} />);
    await screen.findByText('No runs yet.');
    fireEvent.change(screen.getByLabelText(/topic/), { target: { value: 'fuel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));

    await screen.findByText('Ask the analyst');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/api/agent-lab/flows/f1/runs');
    expect(post.body).toEqual({ inputs: { topic: 'fuel' } });
    expect(post.headers!['Idempotency-Key']).toMatch(/\S{8,}/);
    expect(screen.getByText(/All good/)).toBeTruthy();
    expect(screen.getByText('disk full')).toBeTruthy();
    expect(screen.getByText('2 attempts')).toBeTruthy();
  });

  it('does not offer a real run for a draft or unsaved changes, and says why', async () => {
    api();
    const { rerender } = render(<RunsPanel flowId="f1" def={def} status="draft" dirty={false} onClose={() => {}} />);
    await screen.findByText('No runs yet.');
    expect((screen.getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Publish this automation to run it for real.')).toBeTruthy();
    rerender(<RunsPanel flowId="f1" def={def} status="active" dirty={true} onClose={() => {}} />);
    expect((screen.getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save your changes first/)).toBeTruthy();
  });

  it('shows why a run could not start', async () => {
    api({ startStatus: 422, startBody: { error: 'This automation is blocked by policy checks', details: { findings: [{ message: 'needs permission "flow:sql"' }] } } });
    render(<RunsPanel flowId="f1" def={def} status="active" dirty={false} onClose={() => {}} />);
    await screen.findByText('No runs yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect((await screen.findByRole('alert')).textContent).toContain('needs permission "flow:sql"');
  });

  it('lists past runs and opens one; back returns to the list', async () => {
    api({ runs: [run(), run({ id: 'r2', status: 'failed' })] });
    render(<RunsPanel flowId="f1" def={def} status="active" dirty={false} onClose={() => {}} />);
    const list = await screen.findByRole('region', { name: 'Past runs' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('button')[0]!);
    await screen.findByText('Ask the analyst');
    fireEvent.click(screen.getByRole('button', { name: 'Back to all runs' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Past runs' })).toBeTruthy());
  });

  it('approves a paused run and shows it finish; a refused decision says so', async () => {
    const waiting = {
      ...detail({ status: 'waiting_approval' }),
      steps: [
        { stepId: 'ask', status: 'succeeded', attempts: 1, output: { text: 'draft' }, error: null, startedAt: null, finishedAt: null },
        { stepId: 'gate', status: 'waiting_approval', attempts: 1, error: null, startedAt: null, finishedAt: null },
      ],
    };
    const gatedDef: Def = { name: 'g', steps: [{ id: 'ask', type: 'agent', config: { prompt: 'x' } }, { id: 'gate', type: 'approval', name: 'Release it', config: { message: 'Send the summary to the fleet team?' } }] };
    let decided = false;
    let refuse = false;
    const bodies: any[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const path = new URL(String(input), 'http://test').pathname;
      if (path.endsWith('/approval')) {
        bodies.push(JSON.parse(String(init!.body)));
        if (refuse) return json(403, { error: 'Forbidden' });
        decided = true;
        return json(200, { run: run() });
      }
      if (path.endsWith('/runs')) return json(200, { runs: [run({ status: decided ? 'succeeded' : 'waiting_approval' })] });
      return json(200, { run: decided ? { ...detail(), steps: [{ stepId: 'ask', status: 'succeeded', attempts: 1, output: {}, error: null, startedAt: null, finishedAt: null }, { stepId: 'gate', status: 'succeeded', attempts: 1, output: { approved: true }, error: null, startedAt: null, finishedAt: null }] } : waiting });
    });
    render(<RunsPanel flowId="f1" def={gatedDef} status="active" dirty={false} onClose={() => {}} />);
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Past runs' })).findByRole('button'));
    const card = await screen.findByRole('region', { name: 'Approval needed' });
    expect(within(card).getByText('Send the summary to the fleet team?')).toBeTruthy();

    refuse = true;
    fireEvent.click(within(card).getByRole('button', { name: /Reject/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('not allowed');

    refuse = false;
    fireEvent.change(within(card).getByLabelText(/Comment/), { target: { value: 'ok' } });
    fireEvent.click(within(card).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Approval needed' })).toBeNull());
    expect(bodies.at(-1)).toEqual({ stepId: 'gate', decision: 'approve', comment: 'ok' });
  });
});
