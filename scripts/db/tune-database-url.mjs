/**
 * Mirror of `src/lib/db/tune-database-url.ts` for plain Node scripts (keep in sync).
 */
export function tuneDatabaseUrl(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const isDev = process.env.NODE_ENV !== 'production';
    const isWinDev = isDev && process.platform === 'win32';
    const targetLimit = isWinDev ? 1 : isDev ? 5 : 15;
    const limit = Number(url.searchParams.get('connection_limit') ?? '0');
    if (!limit || (isDev ? limit > targetLimit : limit < targetLimit)) {
      url.searchParams.set('connection_limit', String(isDev ? targetLimit : 15));
    }
    const wait = Number(url.searchParams.get('pool_timeout') ?? '0');
    const minPoolWait = isWinDev ? 60 : 30;
    if (!wait || wait < minPoolWait) url.searchParams.set('pool_timeout', String(minPoolWait));
    const connectTimeout = Number(url.searchParams.get('connect_timeout') ?? '0');
    if (isDev && (!connectTimeout || connectTimeout < 45)) {
      url.searchParams.set('connect_timeout', '45');
    }
    const remoteDev = isDev && /\.rds\.amazonaws\.com$/i.test(url.hostname);
    if (remoteDev) {
      if (!url.searchParams.has('keepalives')) url.searchParams.set('keepalives', '1');
      if (!url.searchParams.has('keepalives_idle')) url.searchParams.set('keepalives_idle', '30');
      if (!url.searchParams.has('keepalives_interval')) url.searchParams.set('keepalives_interval', '10');
    }
    return url.toString();
  } catch {
    return raw;
  }
}