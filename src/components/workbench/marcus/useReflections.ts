import { useState, useEffect, useCallback } from 'react';

export interface Reflection {
  id: string;
  triggerType: string;
  technique: string;
  headline: string;
  body: string;
  severity: 'note' | 'caution' | 'gate';
  suggestedAction?: { kind: string; target?: string; label?: string } | null;
  status: string;
  deliveredAt: string | null;
  turnIndex: number;
}

export function useReflections(sessionId: string | null) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [dismissed, setDismissed] = useState<Map<string, { technique: string; summary: string }>>(new Map());

  const markDelivered = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent-lab/marcus/reflections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delivered' }),
      });
    } catch (e) {
      console.error('Failed to mark delivered:', e);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/agent-lab/marcus/reflections?sessionId=${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const data = await res.json();
          const pending = data.pendingReflections || [];

          if (mounted && pending.length > 0) {
            setReflections(prev => {
              const newRefs = pending.filter((p: Reflection) => !prev.find(r => r.id === p.id));
              if (newRefs.length > 0) {
                newRefs.forEach((r: Reflection) => {
                  if (!r.deliveredAt) markDelivered(r.id);
                });
                return [...prev, ...newRefs];
              }
              return prev;
            });
          }
        }
      } catch {
        // ignore fetch errors
      }
    };

    const interval = setInterval(poll, 5000);
    poll(); // Initial poll

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId, markDelivered]);

  const dismiss = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent-lab/marcus/reflections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismissed' }),
      });
    } catch (e) {
      console.error(e);
    }
    const reflection = reflections.find(r => r.id === id);
    if (reflection) {
      setDismissed(prev => new Map(prev).set(id, {
        technique: reflection.technique,
        summary: reflection.headline,
      }));
      // We don't remove from reflections so it can be restored
    }
  }, [reflections]);

  const acknowledge = useCallback(async (id: string) => {
    try {
      await fetch(`/api/agent-lab/marcus/reflections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acknowledged' }),
      });
    } catch (e) {
      console.error(e);
    }
    setReflections(prev => prev.filter(r => r.id !== id));
    setDismissed(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const act = useCallback(async (id: string, action: { kind: string; target?: string }) => {
    try {
      await fetch(`/api/agent-lab/marcus/reflections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'acted', payload: action }),
      });
    } catch (e) {
      console.error(e);
    }
    setReflections(prev => prev.filter(r => r.id !== id));
    setDismissed(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const restoreReflection = useCallback((id: string) => {
    setDismissed(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return { reflections, dismissed, dismiss, acknowledge, act, markDelivered, restoreReflection };
}
