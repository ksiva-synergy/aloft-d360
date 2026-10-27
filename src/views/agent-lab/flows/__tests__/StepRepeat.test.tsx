// @vitest-environment jsdom
/**
 * Step panel, "Repeat for each item": offered only on step types that can repeat, it writes
 * `forEach` (list ref, item limit, parallelism) to the step and removes it again.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepEditor } from '../FlowForm';
import type { Def, Step } from '../editor-model';

afterEach(() => vi.restoreAllMocks());

function renderStep(step: Step) {
  const def: Def = { name: 'x', steps: [{ id: 'list_docs', type: 'tool', config: { capability: 'object_store.list', input: {} } }, step] };
  const onChange = vi.fn();
  const utils = render(<StepEditor step={step} def={def} onChange={onChange} onClose={() => {}} capabilities={[]} onFixture={() => {}} />);
  return { onChange, ...utils };
}

describe('repeat for each item', () => {
  it('turns repeating on with a list from the step it runs after, and edits the limit', () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const step: Step = { id: 'ask', type: 'agent', dependsOn: ['list_docs'], config: { prompt: 'Summarise {{item.key}}' } };
    const { onChange, rerender } = renderStep(step);
    fireEvent.click(screen.getByRole('checkbox', { name: /Repeat for each item/ }));
    const on = onChange.mock.calls[0]![0] as Def;
    expect(on.steps![1]!.forEach).toEqual({ items: '{{steps.list_docs.rows}}', maxItems: 100, concurrency: 4 });

    const repeating = on.steps![1]!;
    rerender(<StepEditor step={repeating} def={on} onChange={onChange} onClose={() => {}} capabilities={[]} onFixture={() => {}} />);
    fireEvent.change(screen.getByLabelText('List'), { target: { value: '{{steps.list_docs.objects}}' } });
    fireEvent.change(screen.getByLabelText('Item limit'), { target: { value: '250' } });
    expect((onChange.mock.calls[1]![0] as Def).steps![1]!.forEach!.items).toBe('{{steps.list_docs.objects}}');
    expect((onChange.mock.calls[2]![0] as Def).steps![1]!.forEach!.maxItems).toBe(250);

    fireEvent.click(screen.getByRole('checkbox', { name: /Repeat for each item/ }));
    expect((onChange.mock.calls[3]![0] as Def).steps![1]!.forEach).toBeUndefined();
  });

  it('is not offered on steps that cannot repeat', () => {
    renderStep({ id: 'ok', type: 'approval', config: { message: 'Approve?' } });
    expect(screen.queryByRole('checkbox', { name: /Repeat for each item/ })).toBeNull();
  });
});
