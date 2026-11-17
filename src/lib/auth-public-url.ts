/**
 * Entra ID treats `localhost` and `127.0.0.1` as different redirect URIs. Local app
 * registrations usually only list `http://localhost:PORT/...`. Windows dev often binds
 * 127.0.0.1 while NEXTAUTH_URL in .env matches — normalize before next-auth runs.
 */
const AUTH_URL_KEYS = ['NEXTAUTH_URL', 'NEXTAUTH_URL_INTERNAL'] as const;

function localhostOrigin(port: string): string {
  return `http://localhost:${port}`;
}

function normalizeLoopbackOrigin(raw: string): string {
  const u = new URL(raw);
  if (u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1') {
    u.hostname = 'localhost';
  }
  return u.origin;
}

/**
 * Idempotent. No-op in production unless `AUTH_PUBLIC_URL_FORCE=1` is set with production.
 */
export function ensureAuthPublicUrl(): void {
  const force = process.env.AUTH_PUBLIC_URL_FORCE === '1';
  if (process.env.NODE_ENV === 'production' && !force) return;

  const port = String(process.env.PORT ?? process.env.WEB_PORT ?? 3000);

  for (const key of AUTH_URL_KEYS) {
    const raw = process.env[key];
    if (!raw?.trim()) {
      process.env[key] = localhostOrigin(port);
      continue;
    }
    try {
      process.env[key] = normalizeLoopbackOrigin(raw.trim());
    } catch {
      /* keep invalid value — next-auth will surface the error */
    }
  }
}