'use client';

import { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { applyAppearance, loadAppearance } from '@/lib/theme/appearance';
import { THEME_COOKIE_NAME, themeCookieValue } from '@/lib/theme/cookie';

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

function ThemeCookieSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!resolvedTheme || resolvedTheme === 'system') return;
    const isDark = resolvedTheme === 'dark';
    document.cookie = `${THEME_COOKIE_NAME}=${themeCookieValue(isDark)};path=/;max-age=31536000;SameSite=Lax`;
  }, [resolvedTheme]);
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
      <ThemeCookieSync />
      {children}
    </NextThemesProvider>
  );
}
