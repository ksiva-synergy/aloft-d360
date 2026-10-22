import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Login gate for the API.
 *
 * Pages are the static Vite app, which sends a signed-out visitor to /login itself
 * (web/src/RequireAuth.tsx). Data comes from /api/**. A signed-out API call must
 * answer with JSON 401. Redirecting to /login makes the browser follow it and
 * receive index.html, which then fails as `Unexpected token '<'` when parsed as JSON.
 * Route handlers also check `getServerSession` themselves.
 *
 * The matcher already lets /api/auth/* and /api/health through without this gate.
 */
export default async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return NextResponse.next();
}

// Only the API is guarded. `/api/auth/*` and `/api/health` are excluded here as well as in `authorized`.
export const config = {
  matcher: ['/api/((?!auth(?:/|$)|health$).*)'],
};
