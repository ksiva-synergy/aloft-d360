'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useThemeIsDarkSnapshot } from '@/components/providers/ThemeIsDarkProvider';

/**
 * SSR-safe dark-mode detection.
 *
 * Before next-themes hydrates, returns the theme cookie snapshot from the
 * server so inline styles match the first client render (no hydration mismatch).
 * After mount, uses `resolvedTheme`.
 */
export function useIsDark(): boolean {
  const initialIsDark = useThemeIsDarkSnapshot();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return initialIsDark;

  return resolvedTheme === 'dark';
}
