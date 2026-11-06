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

/**
 * The signed-in person's section levels, or null while loading (or if the call failed).
 * UX only: the server checks every request itself (src/lib/sections/server.ts).
 */
export function useSectionLevels(): MeSections | null {
  const { data } = useSession();
  const userId = data?.user?.id ?? null;
  const [state, setState] = useState<{ userId: string; value: MeSections | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void load(userId).then((value) => {
      if (live) setState({ userId, value });
    });
    return () => {
      live = false;
    };
  }, [userId]);

  return state && state.userId === userId ? state.value : null;
}

/** Level for one section; null while loading. */
export function useSectionLevel(sectionId: string): SectionLevel | null {
  const me = useSectionLevels();
  return me ? (me.levels[sectionId] ?? 'none') : null;
}
