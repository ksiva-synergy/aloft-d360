import { withAuth } from 'next-auth/middleware';

/**
 * Login gate for the API.
 *
 * Pages are no longer served by Next.js: every page URL is the static Vite app (public, no data), which redirects a
 * signed-out visitor to /login itself (web/src/RequireAuth.tsx). All data comes from /api/**, so that is what is guarded
 * here. Route handlers also check `getServerSession` themselves (defense in depth).
 */
export default withAuth(
  function proxy(_req) {
    // Future: inject userId/role from token for API request logging
  },
  {
    pages: { signIn: '/login' },
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;

        // Public API paths — sign-in itself and the health check.
        if (path.startsWith('/api/auth') || path === '/api/health') {
          return true;
        }

        return !!token;
      },
    },
  }
);

// Only the API is guarded. `/api/auth/*` and `/api/health` are excluded here as well as in `authorized`.
export const config = {
  matcher: ['/api/((?!auth(?:/|$)|health$).*)'],
};
