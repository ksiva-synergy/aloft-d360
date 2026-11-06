'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import {
  canUseDeveloperModeToggle,
  DEVELOPER_MODE_CHANGED_EVENT,
  readDeveloperModeEnabled,
  showDeveloperUI,
  writeDeveloperModeEnabled,
} from '@/lib/client/developer-mode';

export function useDeveloperMode() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canToggle = canUseDeveloperModeToggle(role);
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEnabled(readDeveloperModeEnabled());
    setHydrated(true);
    const sync = () => setEnabled(readDeveloperModeEnabled());
    window.addEventListener(DEVELOPER_MODE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DEVELOPER_MODE_CHANGED_EVENT, sync);
  }, []);

  const developerMode = hydrated && showDeveloperUI(role, enabled);

  const setDeveloperMode = useCallback(
    (on: boolean) => {
      if (!canToggle) return;
      writeDeveloperModeEnabled(on);
      setEnabled(on);
    },
    [canToggle],
  );

  return { canToggle, developerMode, enabled, setDeveloperMode, hydrated };
}
