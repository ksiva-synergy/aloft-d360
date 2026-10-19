import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { companionActivity } from '@/lib/companion/activity';
import { COMPANION_KEY, DEFAULT_COMPANION, parseCompanionPreferences } from '@/lib/companion/preferences';
import { CaptainStatus } from '@/components/companion/CaptainStatus';
import { Captain } from '@/components/companion/Captain';
import { CompanionSettings } from '@/components/companion/CompanionSettings';
import { saveCompanionPreferences } from '@/hooks/useCompanionPreferences';

const tool = { callId: '1', toolId: 'search', toolName: 'Search catalog', status: 'running' as const };
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
beforeEach(() => { localStorage.clear(); saveCompanionPreferences(DEFAULT_COMPANION); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Captain activity', () => {
  it('follows stream and tool facts, including tools after partial prose', () => {
    expect(companionActivity({ isStreaming: true }).state).toBe('reading');
    expect(companionActivity({ isStreaming: true, thinking: 'Reasoning' }).state).toBe('thinking');
    expect(companionActivity({ isStreaming: true, content: 'Draft' }).state).toBe('writing');
    expect(companionActivity({ isStreaming: true, content: 'Draft', toolCalls: [tool] })).toEqual({ state: 'tools', label: 'Using Search catalog' });
    expect(companionActivity({ isStreaming: true, content: 'Draft', toolCalls: [{ ...tool, status: 'success' }] }).state).toBe('writing');
    expect(companionActivity({ isStreaming: true, content: 'Draft', activity: 'thinking', toolCalls: [{ ...tool, status: 'success' }] }).state).toBe('thinking');
  });
  it('never celebrates stopped, failed, truncated, or clarification turns', () => {
    const base = { isStreaming: false, content: 'Partial response' };
    expect(companionActivity({ ...base, interrupted: true }).state).toBe('stopped');
    expect(companionActivity({ ...base, outcome: 'truncated' }).state).toBe('stopped');
    expect(companionActivity({ ...base, outcome: 'errored' }).state).toBe('error');
    expect(companionActivity({ ...base, error: 'Disconnected' }).state).toBe('error');
    expect(companionActivity({ ...base, toolCalls: [{ ...tool, status: 'error' }] }).state).toBe('error');
    expect(companionActivity({ ...base, needsClarification: true }).state).toBe('clarification');
    expect(companionActivity({ isStreaming: false }).state).toBe('idle');
  });
  it('settles after a real completion without celebrating loaded history', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CaptainStatus isStreaming content="Draft" />, { wrapper });
    rerender(<CaptainStatus isStreaming={false} content="Finished" />);
    expect(container.querySelector('[data-captain-state]')).toHaveAttribute('data-captain-state', 'success');
    act(() => vi.advanceTimersByTime(1500));
    expect(container.querySelector('[data-captain-state]')).toHaveAttribute('data-captain-state', 'idle');
    expect(screen.getByRole('status')).toHaveTextContent('Response ready');
    const history = render(<CaptainStatus active={false} isStreaming={false} content="Earlier" />, { wrapper });
    expect(history.container.querySelector('[data-captain-state]')).toHaveAttribute('data-captain-state', 'idle');
    expect(history.container.querySelector('[data-animate]')).toHaveAttribute('data-animate', 'false');
  });
  it('cancels celebration when the next request starts', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CaptainStatus isStreaming />, { wrapper });
    rerender(<CaptainStatus isStreaming={false} content="Done" />);
    rerender(<CaptainStatus isStreaming />);
    act(() => vi.advanceTimersByTime(1500));
    expect(container.querySelector('[data-captain-state]')).toHaveAttribute('data-captain-state', 'reading');
  });
});

describe('Captain preferences', () => {
  it('validates malformed and unsupported browser preferences', () => {
    for (const raw of ['broken', 'null', '[]', '{"color":"url(evil)","personality":"chaotic"}']) expect(parseCompanionPreferences(raw)).toEqual(DEFAULT_COMPANION);
    expect(parseCompanionPreferences('{"color":"accent","personality":"quiet"}')).toEqual({ color: 'accent', personality: 'quiet' });
  });
  it('updates every mounted companion immediately from keyboard-accessible controls', () => {
    const { container } = render(<><CompanionSettings /><Captain /></>);
    fireEvent.click(screen.getByRole('radio', { name: 'Violet' }));
    fireEvent.click(screen.getByRole('radio', { name: /Quiet/ }));
    expect(JSON.parse(localStorage.getItem(COMPANION_KEY)!)).toEqual({ color: '#b9a4ff', personality: 'quiet' });
    expect([...container.querySelectorAll('[data-personality]')].every(el => el.getAttribute('data-personality') === 'quiet')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset companion' }));
    expect(JSON.parse(localStorage.getItem(COMPANION_KEY)!)).toEqual(DEFAULT_COMPANION);
  });
  it('syncs another tab and resets when storage is cleared', () => {
    const { container } = render(<Captain />);
    act(() => {
      localStorage.setItem(COMPANION_KEY, JSON.stringify({ color: '#aabbcc', personality: 'expressive' }));
      window.dispatchEvent(new StorageEvent('storage', { key: COMPANION_KEY }));
    });
    expect(container.querySelector('[data-personality]')).toHaveAttribute('data-personality', 'expressive');
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(container.querySelector('[data-personality]')).toHaveAttribute('data-personality', 'balanced');
  });
  it('keeps preferences usable when storage writes are denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { container } = render(<Captain />);
    act(() => saveCompanionPreferences({ color: '#aabbcc', personality: 'quiet' }));
    expect(container.querySelector('[data-personality]')).toHaveAttribute('data-personality', 'quiet');
  });
  it('assigns unique SVG gradients across multiple messages', () => {
    const { container } = render(<><Captain /><Captain /><Captain /></>);
    const ids = [...container.querySelectorAll('linearGradient')].map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
