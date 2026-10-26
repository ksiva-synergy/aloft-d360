import { useEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useSession } from 'next-auth/react';
import { firstNameOf, rememberFirstName } from '@/lib/login-greeting';

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
  if (status === 'authenticated') hasBeenAuthenticated.current = true;

  // Remember just the first name so the login page can say "Welcome back" next time (see login-greeting.ts).
  const user = data?.user;
  useEffect(() => {
    if (status === 'authenticated') rememberFirstName(firstNameOf(user?.name, user?.email));
  }, [status, user?.name, user?.email]);

  if (status === 'loading' && !hasBeenAuthenticated.current) return <FullPageMessage text="Loading…" />;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function FullPageMessage({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-screen items-center justify-center text-sm text-[var(--ink-3)]"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {text}
    </div>
  );
}
