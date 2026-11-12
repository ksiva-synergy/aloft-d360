// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useQueuedSend } from '../useQueuedSend';

type Props = { isStreaming: boolean; hasError: boolean; resetKey?: string | null };

function setup(initial: Props = { isStreaming: false, hasError: false, resetKey: 's1' }) {
  const state = { streaming: initial.isStreaming };
  const send = vi.fn((_text: string) => {
    if (state.streaming) return false;
    state.streaming = true;
    return true;
  });
  const stop = vi.fn(() => { state.streaming = false; });
  const restoreDraft = vi.fn();
  const hook = renderHook((props: Props) => useQueuedSend({
    ...props,
    isBusy: () => state.streaming,
    send,
    stop,
    restoreDraft,
  }), { initialProps: initial });
  const finish = (hasError = false) => {
    state.streaming = false;
    hook.rerender({ isStreaming: false, hasError, resetKey: 's1' });
  };
  const streaming = () => hook.rerender({ isStreaming: true, hasError: false, resetKey: 's1' });
  return { hook, send, stop, restoreDraft, finish, streaming, state };
}

describe('useQueuedSend', () => {
  it('repeat clicks on the same question while it starts send it once', () => {
    const { hook, send } = setup();
    act(() => { hook.result.current.submit('revenue by month'); });
    act(() => { hook.result.current.submit('revenue by month'); });
    act(() => { hook.result.current.submit('revenue by month'); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(hook.result.current.queued).toBeNull();
  });

  it('queues one merged follow-up and sends it when the reply finishes', () => {
    const { hook, send, finish, streaming } = setup();
    act(() => { hook.result.current.submit('first'); });
    streaming();
    act(() => { hook.result.current.submit('by region'); });
    act(() => { hook.result.current.submit('by region'); });
    act(() => { hook.result.current.submit('only 2025'); });
    expect(hook.result.current.queued).toBe('by region\nonly 2025');
    act(() => { finish(); });
    expect(send).toHaveBeenLastCalledWith('by region\nonly 2025');
    expect(hook.result.current.queued).toBeNull();
  });

  it('Send now stops the reply and sends the queued text with what was typed', () => {
    const { hook, send, stop, streaming } = setup();
    act(() => { hook.result.current.submit('first'); });
    streaming();
    act(() => { hook.result.current.submit('queued'); });
    act(() => { hook.result.current.sendNow('typed'); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('queued\ntyped');
  });

  it('Stop returns the queued text to the composer instead of sending it', () => {
    const { hook, send, restoreDraft, finish, streaming } = setup();
    act(() => { hook.result.current.submit('first'); });
    streaming();
    act(() => { hook.result.current.submit('later'); });
    act(() => { hook.result.current.stop(); });
    act(() => { finish(); });
    expect(restoreDraft).toHaveBeenCalledWith('later');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a failed reply hands the queued text back rather than sending it', () => {
    const { hook, send, restoreDraft, finish, streaming } = setup();
    act(() => { hook.result.current.submit('first'); });
    streaming();
    act(() => { hook.result.current.submit('next'); });
    act(() => { finish(true); });
    expect(restoreDraft).toHaveBeenCalledWith('next');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('switching chats returns the queued text to the composer', () => {
    const { hook, restoreDraft, streaming, state } = setup();
    act(() => { hook.result.current.submit('first'); });
    streaming();
    act(() => { hook.result.current.submit('next'); });
    state.streaming = true;
    hook.rerender({ isStreaming: true, hasError: false, resetKey: 's2' });
    expect(restoreDraft).toHaveBeenCalledWith('next');
    expect(hook.result.current.queued).toBeNull();
  });
});
