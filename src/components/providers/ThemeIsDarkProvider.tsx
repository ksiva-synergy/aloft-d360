'use client';

import { createContext, useContext } from 'react';

const ThemeIsDarkContext = createContext(false);

export function ThemeIsDarkProvider({
  initialIsDark,
  children,
}: {
  initialIsDark: boolean;
  children: React.ReactNode;
}) {
  return (
    <ThemeIsDarkContext.Provider value={initialIsDark}>
      {children}
    </ThemeIsDarkContext.Provider>
  );
}

/** SSR snapshot of dark mode (from theme cookie). Used until next-themes hydrates. */
export function useThemeIsDarkSnapshot(): boolean {
  return useContext(ThemeIsDarkContext);
}
