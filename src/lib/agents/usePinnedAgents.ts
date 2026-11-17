'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { MAX_PINNED_AGENTS, type PinnedAgent } from './pinned-agents-shared';

/**
 * One shared copy of the person's pinned agents for the whole tab, so the sidebar and the Agents page
 * update together. The server (`/api/agent-lab/agents/pins`) is the source of truth; pins follow the
 * person across browsers.
 */
type Snapshot = { pins: PinnedAgent[]; loaded: boolean };

const EMPTY: Snapshot = { pins: [], loaded: false };
let snapshot: Snapshot = EMPTY;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/agent-lab/agents/pins');
      // No access to Agents (403) or signed out (401): simply no pins.
      const data = (await res.json().catch(() => ({}))) as { pins?: PinnedAgent[] };
      emit({ pins: res.ok ? data.pins ?? [] : [], loaded: true });
    } catch {
      emit({ pins: snapshot.pins, loaded: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Drop an agent from the local list after it was deleted (the server row goes with the agent). */
export function forgetPinnedAgent(agentId: string) {
  if (snapshot.pins.some((p) => p.id === agentId)) {
    emit({ ...snapshot, pins: snapshot.pins.filter((p) => p.id !== agentId) });
  }
}

export function usePinnedAgents() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);

  useEffect(() => {
    if (!snapshot.loaded) void load();
  }, []);

  /** Returns an error message, or null on success. Updates optimistically and rolls back on failure. */
  const setPinned = useCallback(async (agent: PinnedAgent, pinned: boolean): Promise<string | null> => {
    const before = snapshot;
    const already = before.pins.some((p) => p.id === agent.id);
    if (pinned && !already && before.pins.length >= MAX_PINNED_AGENTS) {
      return `You can pin up to ${MAX_PINNED_AGENTS} agents. Unpin one first.`;
    }
    emit({
      ...before,
      pins: pinned
        ? already ? before.pins : [...before.pins, agent]
        : before.pins.filter((p) => p.id !== agent.id),
    });
    try {
      const res = await fetch('/api/agent-lab/agents/pins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, pinned }),
      });
      const data = (await res.json().catch(() => ({}))) as { pins?: PinnedAgent[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not update pinned agents');
      emit({ pins: data.pins ?? [], loaded: true });
      return null;
    } catch (err: unknown) {
      emit(before);
      return err instanceof Error ? err.message : 'Could not update pinned agents';
    }
  }, []);

  /** Save a new order (agent ids, top first). Optimistic; rolls back on failure. */
  const reorder = useCallback(async (ids: string[]): Promise<string | null> => {
    const before = snapshot;
    const byId = new Map(before.pins.map((p) => [p.id, p]));
    const next = ids.flatMap((id) => byId.get(id) ?? []);
    const rest = before.pins.filter((p) => !ids.includes(p.id));
    emit({ ...before, pins: [...next, ...rest] });
    try {
      const res = await fetch('/api/agent-lab/agents/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: [...next, ...rest].map((p) => p.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { pins?: PinnedAgent[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not reorder pinned agents');
      emit({ pins: data.pins ?? [], loaded: true });
      return null;
    } catch (err: unknown) {
      emit(before);
      return err instanceof Error ? err.message : 'Could not reorder pinned agents';
    }
  }, []);

  const isPinned = useCallback((agentId: string) => state.pins.some((p) => p.id === agentId), [state.pins]);

  return {
    pins: state.pins,
    loaded: state.loaded,
    full: state.pins.length >= MAX_PINNED_AGENTS,
    isPinned,
    setPinned,
    reorder,
  };
}
