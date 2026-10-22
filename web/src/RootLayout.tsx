import { useEffect } from 'react';
import { Outlet, useMatches } from 'react-router';
import ThemeProvider from '@/components/providers/ThemeProvider';
import { ThemeIsDarkProvider } from '@/components/providers/ThemeIsDarkProvider';
import AuthSessionProvider from '@/components/providers/SessionProvider';

export const DEFAULT_TITLE = 'Agent Lab — Data 360';

export interface RouteHandle {
  /** Replaces Next's `export const metadata.title`. */
  title?: string;
}

/** Sets document.title from the deepest matched route that declares `handle.title`. */
function TitleSync() {
  const matches = useMatches();
  const title =
    [...matches]
      .reverse()
      .map((m) => (m.handle as RouteHandle | undefined)?.title)
      .find(Boolean) ?? DEFAULT_TITLE;
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

/**
 * Replaces `app/layout.tsx`: the same provider stack. The server used the theme cookie for `initialIsDark`;
 * here the blocking boot script in index.html has already put `dark|light` on <html> before React runs.
 */
export function RootLayout() {
  const initialIsDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (
    <ThemeProvider>
      <ThemeIsDarkProvider initialIsDark={initialIsDark}>
        <AuthSessionProvider>
          <TitleSync />
          <Outlet />
        </AuthSessionProvider>
      </ThemeIsDarkProvider>
    </ThemeProvider>
  );
}
