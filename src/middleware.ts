import { withAuth } from 'next-auth/middleware';

export default withAuth(
  function middleware(_req) {
    // Future: inject userId/role from token for API request logging
  },
  {
    pages: { signIn: '/login' },
    callbacks: {
      authorized: ({ token, req }) => {
        const path = req.nextUrl.pathname;

        // Public paths — allow unauthenticated access
        if (
          path === '/' ||
          path.startsWith('/login') ||
          path.startsWith('/_next/') ||
          path.startsWith('/api/auth') ||
          path === '/favicon.ico'
        ) {
          return true;
        }

        return !!token;
      },
    },
  }
);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|api/auth|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)'],
};
