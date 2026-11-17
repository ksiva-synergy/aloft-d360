import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  applyInspectorDraft,
  getInspectorSnapshot,
  inspectorSetters,
  resetInspectorLive,
  subscribeInspectorLive,
} from '@/lib/inspector/inspector-chat-live';

const key = 'test-inspector';

describe('inspector chat live store', () => {
  beforeEach(() => {
    resetInspectorLive(key);
  });

  afterEach(() => {
    resetInspectorLive(key);
    vi.unstubAllGlobals();
  });

  it('keeps the reply after the page unsubscribes', () => {
    const seen: string[] = [];
    const unsub = subscribeInspectorLive(key, () => {
      seen.push(getInspectorSnapshot(key).messages.map((m) => m.content).join('|'));
    });
    const { setLocalMessages, setIsStreaming, setCurrentSessionId } = inspectorSetters(key);
    setCurrentSessionId('sess-1');
    setIsStreaming(true);
    setLocalMessages([
      { id: 'u', role: 'user', content: 'hello', timestamp: 1, turnNumber: 1 },
      { id: 'a', role: 'assistant', content: '', timestamp: 1, turnNumber: 1 },
    ]);
    unsub();

    setLocalMessages((prev) => prev.map((m) => (m.id === 'a' ? { ...m, content: 'still going' } : m)));

    expect(getInspectorSnapshot(key).isStreaming).toBe(true);
    expect(getInspectorSnapshot(key).messages.map((m) => m.content)).toEqual(['hello', 'still going']);
    expect(seen.at(-1)).toBe('hello|');
  });

  it('fills the assistant message from a server draft', () => {
    inspectorSetters(key).setLocalMessages([
      { id: 'u', role: 'user', content: 'hello', timestamp: 1, turnNumber: 1 },
    ]);
    applyInspectorDraft(key, 'from the server', false);
    expect(getInspectorSnapshot(key).messages.at(-1)?.content).toBe('from the server');
    applyInspectorDraft(key, 'from the server, continued', false);
    expect(getInspectorSnapshot(key).messages).toHaveLength(2);
    expect(getInspectorSnapshot(key).messages.at(-1)?.content).toBe('from the server, continued');
  });
});
