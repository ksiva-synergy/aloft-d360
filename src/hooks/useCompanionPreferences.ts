'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { COMPANION_EVENT, COMPANION_KEY, parseCompanionPreferences, type CompanionPreferences } from '@/lib/companion/preferences';

// Keep a usable preference for this tab even when browser storage is unavailable.
let volatilePreference: string | undefined;
function snapshot() {
  if (volatilePreference !== undefined) return volatilePreference;
  try { return window.localStorage.getItem(COMPANION_KEY); }
  catch { return null; }
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === COMPANION_KEY || event.key === null) { volatilePreference = undefined; notify(); }
  };
  window.addEventListener(COMPANION_EVENT, notify);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(COMPANION_EVENT, notify); window.removeEventListener('storage', storage); };
}
const serverSnapshot = () => null;

export function saveCompanionPreferences(preferences: CompanionPreferences) {
  const raw = JSON.stringify(parseCompanionPreferences(JSON.stringify(preferences)));
  volatilePreference = raw;
  try { window.localStorage.setItem(COMPANION_KEY, raw); volatilePreference = undefined; } catch { /* Session-only fallback. */ }
  window.dispatchEvent(new Event(COMPANION_EVENT));
}

export function useCompanionPreferences() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => parseCompanionPreferences(raw), [raw]);
}
