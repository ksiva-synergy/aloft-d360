// @vitest-environment jsdom
/**
 * The "awaiting data / not wired" state is a FIRST-CLASS, typed render state —
 * visibly distinct from a real empty result and from a live chart. This is the
 * anti-false-green guarantee: nobody can demo the shell as done, and a future
 * zero-row `empty` can never be confused with "nothing ran yet".
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotWiredChart } from '../NotWiredChart';
import { awaitingData, type WidgetRenderState } from '@/lib/dashboards/widget-render-state';

describe('NotWiredChart', () => {
  it('renders awaiting_data with a distinct, tagged, honest state', () => {
    const { container } = render(<NotWiredChart state={awaitingData()} chartKindGuess="bar" />);
    const area = container.querySelector('[data-testid="widget-chart-area"]');
    expect(area).toHaveAttribute('data-widget-render-state', 'awaiting_data');
    expect(screen.getByText(/Not wired/i)).toBeInTheDocument();
    expect(screen.getByText(/will render as a bar/i)).toBeInTheDocument();
  });

  it('a real empty result is NOT tagged awaiting_data (the two must stay distinguishable)', () => {
    const empty: WidgetRenderState = { kind: 'empty' };
    const { container } = render(<NotWiredChart state={empty} />);
    const area = container.querySelector('[data-testid="widget-chart-area"]');
    expect(area).not.toHaveAttribute('data-widget-render-state', 'awaiting_data');
    expect(screen.getByText(/No rows for this query/i)).toBeInTheDocument();
    expect(screen.queryByText(/Not wired/i)).not.toBeInTheDocument();
  });
});
