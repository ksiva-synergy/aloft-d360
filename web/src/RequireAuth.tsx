import { useEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router';
import { signOut, useSession } from 'next-auth/react';
import { firstNameOf, rememberFirstName } from '@/lib/login-greeting';

function sessionIsValid(data: ReturnType<typeof useSession>['data']): boolean {
  return !!data?.user?.id && data.error !== 'SessionRevoked';
}

/**
 * Replaces the server-side `getServerSession` + `redirect('/login')` in `(agent)/layout.tsx`.
 *
 * This is a UX guard only. API routes remain protected on the server (src/proxy.ts + per-route
 * `getServerSession`), so a tampered client can see an empty shell but never data.
 *
 * The loading screen is shown for the INITIAL session fetch only. next-auth flips `status` back to
 * 'loading' whenever `update()` runs, and `UserMenu` calls `update()` on mount; unmounting the app on every
 * such flip would remount `UserMenu`, which calls `update()` again, forever (an infinite fetch loop).
 */
export function RequireAuth() {
  const { status, data } = useSession();
  const hasBeenAuthenticated = useRef(false);
  const valid = status === 'authenticated' && sessionIsValid(data);
  if (valid) hasBeenAuthenticated.current = true;

  // Remember just the first name so the login page can say "Welcome back" next time (see login-greeting.ts).
  const user = data?.user;
  useEffect(() => {
    if (valid) rememberFirstName(firstNameOf(user?.name, user?.email));
  }, [valid, user?.name, user?.email]);

  // Stale JWT after suspend/remove: next-auth still says "authenticated" but strips user.id — clear the cookie.
  useEffect(() => {
    if (status === 'authenticated' && !sessionIsValid(data)) {
      void signOut({ callbackUrl: '/login?error=session_expired' });
    }
  }, [status, data]);

  if (status === 'loading' && !hasBeenAuthenticated.current) return <FullPageMessage text="Loading…" />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  if (status === 'authenticated' && !sessionIsValid(data)) {
    return <FullPageMessage text="Signing out…" />;
  }
  return <Outlet />;
}

export function FullPageMessage({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-screen items-center justify-center text-size-body text-[var(--ink-3)]"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {text}
    </div>
  );
}
