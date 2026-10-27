import { handle, ok } from '@/lib/http';
import { createConnection, listConnections } from '@/lib/connections/service';
import { CONNECTION_KINDS, type ConnectionKind } from '@/lib/connections/types';
import { connectionActor } from './_shared';

export const dynamic = 'force-dynamic';

/** Your connections and those shared with the organisation (no credentials). `?kind=` filters. */
export const GET = handle(async (req) => {
  const actor = await connectionActor(req);
  const kind = new URL(req.url).searchParams.get('kind');
  const filter = CONNECTION_KINDS.includes(kind as ConnectionKind) ? (kind as ConnectionKind) : undefined;
  return ok({ connections: await listConnections(actor, filter) });
});

/** Creates a connection owned by the caller: `{ name, kind, config, secret, visibility? }` (private by default). */
export const POST = handle(async (req) => {
  const actor = await connectionActor(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const connection = await createConnection(actor, { name: body.name, kind: body.kind, config: body.config, secret: body.secret, visibility: body.visibility });
  return ok({ connection }, 201);
});
