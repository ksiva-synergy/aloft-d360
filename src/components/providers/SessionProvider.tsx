'use client';

import { SessionProvider } from 'next-auth/react';

export default function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // In local dev, refetching the session when the window regains focus clears the in-memory
  // session if the API is restarting (the fetch fails and next-auth treats that as signed out).
  // Production still refetches so a revoked session is picked up.
  return (
    <SessionProvider refetchOnWindowFocus={process.env.NODE_ENV === 'production'}>
      {children}
    </SessionProvider>
  );
}
