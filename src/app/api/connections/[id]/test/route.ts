import { handle, ok } from '@/lib/http';
import { testConnection } from '@/lib/connections/service';
import { connectionActor } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Anyone who may use the connection. Tries the credentials (read-only) and records the result. */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const actor = await connectionActor(req);
  return ok(await testConnection(actor, (await ctx.params).id));
});
