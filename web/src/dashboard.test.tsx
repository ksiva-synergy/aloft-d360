import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DashboardView } from '@/components/dashboard/DashboardView';
import type { DashboardSummary, JobsSummary } from '@/lib/dashboard/summary';

vi.mock('@/components/dashboard/MemoryCredCard', () => ({ MemoryCredCard: () => null }));
const job = (kind: string, lastStatus = 'failed'): JobsSummary['kinds'][number] => ({
  kind, lastStatus, lastFinishedAt: '2026-11-08T00:00:00Z', runs7d: 1,
  succeeded7d: 0, failed7d: 1, running: 0, queued: 0,
});
const empty: DashboardSummary = { estate: null, memory: null, logins: null, inspector: null, generatedAt: '2026-11-08T00:00:00Z' };
function mount(summary: DashboardSummary, canReadUsers = false) {
  return render(<MemoryRouter><DashboardView summary={summary} displayName="Alex" roleLabel="Member" canReadUsers={canReadUsers} /></MemoryRouter>);
}

describe('dashboard action and readiness presentation', () => {
  it('filters actions by severity and expands the current list', () => {
    mount({ ...empty, jobs: { kinds: [job('silo_scan'), job('t3_usage')], memoryJobs: [] }, governance: { piiTables: 4, piiPending: 4, review: null },
      estate: { sources: 1, estateTotal: 100, harvested: 40, profiled: 30, enriched: 20, embedded: 10, staleCount: 2, queuedJobs: 0, lastSweepAt: new Date().toISOString() } });
    const actions = within(screen.getByRole('region', { name: 'Your action list' }));
    expect(actions.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(actions.getByRole('button', { name: 'View all 4 items' }));
    expect(actions.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(actions.getByRole('button', { name: 'Failures 2' }));
    expect(actions.getAllByRole('listitem')).toHaveLength(2);
    expect(actions.getAllByRole('link')[0]).toHaveAttribute('href', '/agent-lab/estate/jobs?kind=silo_scan');
    fireEvent.click(actions.getByRole('button', { name: 'Follow-ups 0' }));
    expect(actions.getByText('No items in this category.')).toBeInTheDocument();
  });

  it('explains cumulative stages and routes the largest gap to its job', () => {
    mount({ ...empty, estate: { sources: 1, estateTotal: 100, harvested: 90, profiled: 20, enriched: 15, embedded: 10, staleCount: 0, queuedJobs: 0, lastSweepAt: new Date().toISOString() } });
    const readiness = within(screen.getByRole('region', { name: 'Data readiness' }));
    expect(readiness.getByText('Largest coverage gap: data profiled')).toBeInTheDocument();
    expect(readiness.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/agent-lab/estate/jobs?kind=t1_profile');
    expect(readiness.getByText(/Stages show cumulative coverage/)).toBeInTheDocument();
    expect(readiness.getByRole('img')).toHaveAttribute('aria-label', '10 of 100 discovered tables are searchable');
  });

  it('does not claim health when the snapshot is unavailable', () => {
    mount(empty);
    expect(screen.getByText('The action list is not available right now.')).toBeInTheDocument();
    expect(screen.queryByText('No issues reported')).not.toBeInTheDocument();
    expect(screen.getByText('Estate coverage is not available right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('handles an empty estate without invalid percentages or a suggested gap', () => {
    const { container } = mount({ ...empty, estate: { sources: 0, estateTotal: 0, harvested: 0, profiled: 0, enriched: 0, embedded: 0, staleCount: 0, queuedJobs: 0, lastSweepAt: null } });
    expect(screen.getByText(/No tables discovered yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Largest coverage gap/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
