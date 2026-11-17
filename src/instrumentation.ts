export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureAuthPublicUrl } = await import('@/lib/auth-public-url');
  ensureAuthPublicUrl();
  const { warmPrismaConnection } = await import('@/lib/db/warm-connection');
  await warmPrismaConnection();
}