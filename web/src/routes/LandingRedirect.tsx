'use client';

import { Navigate } from 'react-router';
import { primaryNavHref } from '@/components/agent-lab/staging/nav-config';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';
import { FullPageMessage } from '../RequireAuth';

/** Sends signed-in people to the first page their section access allows (members → Ask Data). */
export function LandingRedirect() {
  const me = useSectionLevels();
  if (me === null) return <FullPageMessage text="Loading…" />;
  return <Navigate to={primaryNavHref(me.levels)} replace />;
}
