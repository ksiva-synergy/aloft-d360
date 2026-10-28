// @vitest-environment jsdom
/**
 * "Ask an agent" step panel: pick a saved agent (ready ones apart from drafts), ask for the answer
 * as fields, try it once with sample values, and keep the real answer as the step's sample response.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepEditor } from '../FlowForm';
import type { Def, Step } from '../editor-model';

const AGENTS = [
  { slug: 'regulatory-decision-tracer', name: 'Regulatory Decision Tracer', description: 'Traces regulatory decisions to their source', status: 'live', runnable: true },
  { slug: 'databricks-jobs-agent-a', name: 'Databricks Jobs Agent', description: null, status: 'draft', runnable: false },
  { slug: 'databricks-jobs-agent-b', name: 'Databricks Jobs Agent', description: null, status: 'draft', runnable: false },
  { slug: 'demand-signal-forecaster', name: 'Demand Signal Forecaster', description: null, status: 'live', runnable: false, hasInstructions: false },
];

function Harness({ config, onDef, onFixture }: { config: Record<string, unknown>; onDef: (d: Def) => void; onFixture: (v: unknown) => void }) {
  const [def, setDef] = useState<Def>({ name: 'x', steps: [{ id: 'check', type: 'agent', config }] });
  return (
    <StepEditor
      step={def.steps![0] as Step}
      def={def}
      onChange={(d) => {
        setDef(d);
        onDef(d);
      }}
      onClose={() => {}}
      capabilities={[]}
      onFixture={onFixture}
    />
  );
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.restoreAllMocks());

describe('agent step', () => {
  it('picks an agent, asks for answer fields, tries it and keeps the answer as the sample', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/agent-lab/flows/agents') return json(200, { agents: AGENTS });
      return json(200, {
        agent: { name: 'Regulatory Decision Tracer' },
        model: 'us.amazon.nova-pro-v1:0',
        outcome: 'completed',
        text: 'Voyage V-12 complies.',
        answer: { values: { compliant: 'yes' }, missing: [], issues: {}, notes: 'Checked 4 rules.' },
        loops: 2,
        toolCalls: 1,
        costUsd: 0.0085,
        durationMs: 4200,
      });
    });
    let def: Def | undefined;
    const onFixture = vi.fn();
    render(<Harness config={{ prompt: 'Does voyage {{item.voyage}} comply?' }} onDef={(d) => (def = d)} onFixture={onFixture} />);

    const picker = screen.getByLabelText('Agent') as HTMLSelectElement;
    await within(picker).findByRole('option', { name: 'Regulatory Decision Tracer' });
    expect(within(picker).getByRole('group', { name: 'Drafts (can be tried, not published)' })).toBeTruthy();
    // Same name twice: the slug tells them apart.
    expect(within(picker).getByRole('option', { name: 'Databricks Jobs Agent (databricks-jobs-agent-a) · draft' })).toBeTruthy();
    // A catalog entry with no instructions is shown but cannot be chosen.
    expect(within(within(picker).getByRole('group', { name: 'Not set up (no instructions)' })).getByRole('option', { name: 'Demand Signal Forecaster' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(picker, { target: { value: 'regulatory-decision-tracer' } });
    expect(def!.steps![0]!.config.agentSlug).toBe('regulatory-decision-tracer');
    expect(screen.getByText('Traces regulatory decisions to their source')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Get the answer as specific fields/ }));
    fireEvent.change(screen.getByLabelText('Field 1 name'), { target: { value: 'Compliant' } });
    fireEvent.change(screen.getByLabelText('Field 1 description'), { target: { value: 'yes or no' } });
    expect(def!.steps![0]!.config.answer).toEqual([{ key: 'compliant', label: 'Compliant', type: 'text', description: 'yes or no' }]);

    // The prompt still has a reference: Try it waits for a sample value.
    const tryButton = screen.getByRole('button', { name: /Try it/ }) as HTMLButtonElement;
    expect(tryButton.disabled).toBe(true);
    expect(screen.getByText(/Replace \{\{item.voyage\}\} with sample values/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/One real run of the agent/), { target: { value: 'Does voyage V-12 comply?' } });
    fireEvent.click(tryButton);

    const table = await screen.findByRole('table', { name: 'Agent answer' });
    expect(within(table).getByRole('rowheader', { name: 'Compliant' }).closest('tr')!.textContent).toContain('yes');
    expect(screen.getByText(/about \$0\.009/)).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith('/agent-try'))!.body).toEqual({
      agentSlug: 'regulatory-decision-tracer',
      prompt: 'Does voyage V-12 comply?',
      answer: [{ key: 'compliant', label: 'Compliant', type: 'text', description: 'yes or no' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use as sample response' }));
    expect(onFixture).toHaveBeenCalledWith({ text: 'Voyage V-12 complies.', values: { compliant: 'yes' }, missing: [], notes: 'Checked 4 rules.' });
  });

  it('shows the reason when the agent cannot run', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) =>
      String(input) === '/api/agent-lab/flows/agents' ? json(200, { agents: AGENTS }) : json(404, { error: 'Agent not found' }),
    );
    render(<Harness config={{ agentSlug: 'regulatory-decision-tracer', prompt: 'Check V-12' }} onDef={() => {}} onFixture={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Try it/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Agent not found');
  });
});
