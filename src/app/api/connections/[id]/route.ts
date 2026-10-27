import { handle, ok } from '@/lib/http';
import { deleteConnection, getConnection, updateConnection } from '@/lib/connections/service';
import { connectionActor } from '../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const actor = await connectionActor(req);
  return ok({ connection: await getConnection(actor, (await ctx.params).id) });
});

/** Owner or platform admin. `{ name?, config?, secret?, visibility? }`. Credentials are replaced only when `secret` is sent. */
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const actor = await connectionActor(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return ok({ connection: await updateConnection(actor, (await ctx.params).id, { name: body.name, config: body.config, secret: body.secret, visibility: body.visibility }) });
});

/** Owner or platform admin. Deletes the connection and schedules its credentials for deletion (7-day recovery in AWS). */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const actor = await connectionActor(req);
  await deleteConnection(actor, (await ctx.params).id);
  return ok({ deleted: true });
});
