/** Cookie mirrored from next-themes `storageKey` so SSR can match client theme. */
export const THEME_COOKIE_NAME = 'theme';

export function themeCookieValue(isDark: boolean): string {
  return isDark ? 'dark' : 'light';
}

export function parseThemeCookie(value: string | undefined): boolean {
  return value === 'dark';
}
