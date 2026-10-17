'use client';

import { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { applyAppearance, loadAppearance } from '@/lib/theme/appearance';

/** Re-applies the saved accent whenever the light/dark class flips, or another tab changes it. */
function AppearanceSync() {
  useEffect(() => {
    const apply = () => applyAppearance(loadAppearance());
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', apply);
    };
  }, []);
  return null;
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="theme">
      <AppearanceSync />
      {children}
    </NextThemesProvider>
  );
}
