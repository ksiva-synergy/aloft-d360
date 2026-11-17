'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { SectionLevel, SectionLevels } from './registry';

interface MeSections {
  role: string;
  platformAdmin: boolean;
  levels: SectionLevels;
}

/** One fetch per signed-in user per page load; every caller shares it. */
let cache: { userId: string; promise: Promise<MeSections | null> } | null = null;

function load(userId: string): Promise<MeSections | null> {
  if (cache?.userId === userId) return cache.promise;
  const promise = fetch('/api/me/sections', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<MeSections>) : null))
    .catch(() => null);
  cache = { userId, promise };
  return promise;
}

type SectionLevelsSnapshot = { userId: string; value: MeSections | null; settled: boolean };

/**
 * Section levels for the signed-in user. `pending` is true until `/api/me/sections` finishes (success or failure).
 * UX only: the server checks every request itself (src/lib/sections/server.ts).
 */
export function useSectionLevelsState(): { data: MeSections | null; pending: boolean } {
  const { data } = useSession();
  const userId = data?.user?.id ?? null;
  const [state, setState] = useState<SectionLevelsSnapshot | null>(null);

  useEffect(() => {
    if (!userId) {
      setState(null);
      return;
    }
    let live = true;
    setState(null);
    void load(userId).then((value) => {
      if (live) setState({ userId, value, settled: true });
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const pending = !!userId && !(state && state.userId === userId && state.settled);
  const levels =
    state && state.userId === userId && state.settled ? state.value : null;
  return { data: levels, pending };
}

/** Levels while `pending`, else the payload (null if the call failed). */
export function useSectionLevels(): MeSections | null {
  const { data, pending } = useSectionLevelsState();
  return pending ? null : data;
}

/** Level for one section; null while loading. */
export function useSectionLevel(sectionId: string): SectionLevel | null {
  const me = useSectionLevels();
  return me ? (me.levels[sectionId] ?? 'none') : null;
}
