'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * SSR-safe dark-mode detection.
 *
 * On first render (before hydration), we read the `.dark` class that
 * next-themes already sets on <html>, so inline styles match CSS variables
 * immediately without a half-light / half-dark flash.
 * After mount, we switch to the authoritative `resolvedTheme` value.
 */
export function useIsDark(): boolean {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains('dark');
  }

  return resolvedTheme === 'dark';
}
