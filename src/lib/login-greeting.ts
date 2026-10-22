/**
 * "Welcome back" on the login page: remembers only the signed-in user's first name, in this browser.
 *
 * Greeting only. It is never sent to the server, never used to identify anyone, never pre-fills a field and never
 * skips sign-in. It expires after 30 days and is cleared on sign-out or when the user clicks "Not you?".
 */
const KEY = 'login-greeting';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** First word of the display name (or the email's local part), letters only, at most 20 characters. */
export function firstNameOf(name?: string | null, email?: string | null): string {
  const raw = name?.trim().split(/\s+/)[0] || email?.split('@')[0].split(/[._\-+0-9]/)[0] || '';
  const letters = raw.replace(/[^\p{L}]/gu, '').slice(0, 20);
  return letters ? letters[0].toUpperCase() + letters.slice(1).toLowerCase() : '';
}

export function rememberFirstName(first: string) {
  if (!first) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ first, at: Date.now() }));
  } catch {
    /* storage blocked: no greeting next time */
  }
}

export function recallFirstName(): string {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { first?: unknown; at?: unknown } | null;
    if (!saved || typeof saved.first !== 'string' || typeof saved.at !== 'number' || Date.now() - saved.at > TTL_MS) {
      localStorage.removeItem(KEY);
      return '';
    }
    return firstNameOf(saved.first);
  } catch {
    return '';
  }
}

export function forgetFirstName() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}
