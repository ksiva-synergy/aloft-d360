export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { warmPrismaConnection } = await import('@/lib/db/warm-connection');
  await warmPrismaConnection();
}