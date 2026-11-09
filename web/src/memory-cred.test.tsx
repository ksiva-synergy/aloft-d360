import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCredCard } from '@/components/dashboard/MemoryCredCard';
const entry = { rank: 1, seasonXp: 61, cred: 86, provisional: false, zone: 'promotion', movement: null, isYou: true, displayName: 'Alex' };
const data = { domains: ['Inspector', 'Research'], cohortSize: 30, view: { domain: 'Inspector', league: 0, leagueSize: 5, top: [entry, { ...entry, rank: 2, cred: 92, seasonXp: 34, isYou: false, displayName: 'Sam' }], around: [], you: entry } };
afterEach(() => vi.unstubAllGlobals());
describe('memory contribution card', () => {
  it('labels XP and trust separately and suppresses small-group league zones', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    render(<MemoryCredCard />);
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Season XP' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Trust / 100' })).toBeInTheDocument();
    expect(screen.queryByText('Promotion zone')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Your contribution' })).toHaveTextContent('#1');
  });
  it('shows a loading state and cancels the previous request when switching classes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data))).mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    render(<MemoryCredCard />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Research' }));
    await screen.findByText('Loading leaderboard…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it('keeps an unranked roster before anyone earns XP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...data, view: { ...data.view, top: [{ ...entry, seasonXp: 0 }] } }))));
    render(<MemoryCredCard />);
    expect(await screen.findByText(/Cred is earned, not given/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
