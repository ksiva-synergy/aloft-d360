import { handle, ok } from '@/lib/http';
import { browseConnection } from '@/lib/connections/service';
import { connectionActor } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Anyone who may use the connection. One folder level: `?path=<relative to the root>&max=100`. Read-only. */
export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const actor = await connectionActor(req);
  const url = new URL(req.url);
  const max = Number(url.searchParams.get('max') ?? 100) || 100;
  return ok(await browseConnection(actor, (await ctx.params).id, url.searchParams.get('path') ?? '', max));
});
