import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router';
import { signOut, useSession } from 'next-auth/react';
import { firstNameOf, rememberFirstName } from '@/lib/login-greeting';

function sessionIsValid(data: ReturnType<typeof useSession>['data']): boolean {
  return !!data?.user?.id && data.error !== 'SessionRevoked';
}

/**
 * Local Vite only. A failed `/api/auth/session` (API restart) is not a logout.
 * Unit tests run with MODE=test and keep the immediate redirect.
 */
function keepLocalLogin(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== 'test';
}

const DEV_RELOAD_AT = 'aloft-dev-session-reload-at';

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
  // 'checking' until the session endpoint confirms there is no cookie. A down API stays here.
  const [probe, setProbe] = useState<'checking' | 'signed-out'>('checking');

  // Remember just the first name so the login page can say "Welcome back" next time (see login-greeting.ts).
  const user = data?.user;
  useEffect(() => {
    if (valid) {
      rememberFirstName(firstNameOf(user?.name, user?.email));
      sessionStorage.removeItem(DEV_RELOAD_AT);
    }
  }, [valid, user?.name, user?.email]);

  // Stale JWT after suspend/remove: next-auth still says "authenticated" but strips user.id — clear the cookie.
  useEffect(() => {
    if (status === 'authenticated' && !sessionIsValid(data)) {
      void signOut({ callbackUrl: '/login?error=session_expired' });
    }
  }, [status, data]);

  // Dev server restarts make next-auth report "unauthenticated" when the fetch fails, and it will not
  // try again. Ask the session endpoint directly: a real sign-out is HTTP 200 with no user; anything
  // else means the API is down and the cookie should be kept.
  useEffect(() => {
    if (!keepLocalLogin() || status !== 'unauthenticated') return;
    let cancelled = false;
    let settled = false;
    setProbe('checking');
    const tick = async () => {
      if (cancelled || settled) return;
      try {
        const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
        if (cancelled || settled || !res.ok) return;
        const body = (await res.json()) as { user?: { id?: string }; error?: string } | null;
        if (cancelled || settled) return;
        if (body?.user?.id && body.error !== 'SessionRevoked') {
          const last = Number(sessionStorage.getItem(DEV_RELOAD_AT) || 0);
          if (Date.now() - last > 4000) {
            settled = true;
            sessionStorage.setItem(DEV_RELOAD_AT, String(Date.now()));
            window.location.reload();
          }
          return;
        }
        settled = true;
        setProbe('signed-out');
      } catch {
        // API not reachable yet. Stay on the reconnecting screen.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);

  if (status === 'loading' && !hasBeenAuthenticated.current) return <FullPageMessage text="Loading…" />;
  if (status === 'unauthenticated') {
    if (keepLocalLogin() && probe !== 'signed-out') return <FullPageMessage text="Reconnecting…" />;
    return <Navigate to="/login" replace />;
  }
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
