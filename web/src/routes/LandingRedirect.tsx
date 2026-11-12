'use client';

import { Navigate } from 'react-router';
import { useSession } from 'next-auth/react';
import { primaryNavHref } from '@/components/agent-lab/staging/nav-config';
import { useSectionLevelsState } from '@/lib/sections/useSectionLevels';
import { FullPageMessage } from '../RequireAuth';

function sessionIsValid(data: ReturnType<typeof useSession>['data']): boolean {
  return !!data?.user?.id && data.error !== 'SessionRevoked';
}

/**
 * Sends signed-in people to the first page their section access allows (members → Ask Data).
 * Unlike `/dashboard`, this route is outside `RequireAuth`, so it must send signed-out visitors to `/login`
 * itself — otherwise `useSectionLevels` never runs and the app sits on “Loading…” forever.
 */
export function LandingRedirect() {
  const { status, data } = useSession();
  const { data: me, pending: sectionsPending } = useSectionLevelsState();

  if (status === 'loading') return <FullPageMessage text="Loading…" />;
  if (status === 'unauthenticated' || !sessionIsValid(data)) {
    return <Navigate to="/login" replace />;
  }
  if (sectionsPending) return <FullPageMessage text="Loading…" />;
  if (!me) return <Navigate to="/dashboard" replace />;
  return <Navigate to={primaryNavHref(me.levels)} replace />;
}
