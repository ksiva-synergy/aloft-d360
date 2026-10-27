import 'server-only';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/** RBAC role of the signed-in user from the NextAuth session (server only). */
export async function getSessionUserRole(): Promise<string | undefined> {
  const session = await getServerSession(authOptions);
  return (session?.user as { role?: string } | undefined)?.role;
}
