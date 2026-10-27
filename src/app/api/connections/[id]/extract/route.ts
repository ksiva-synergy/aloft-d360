import { z } from 'zod';
import { handle, ok, parse } from '@/lib/http';
import { extractFromConnection } from '@/lib/extraction/service';
import { connectionActor } from '../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const body = z.object({
  path: z.string().trim().min(1).max(1024),
  schema: z.string().trim().min(1).max(120).optional(),
  fields: z.array(z.record(z.unknown())).max(100).optional(),
});

/**
 * Anyone who may use the connection. Reads one document with Grok: `{ path, schema }` for a
 * built-in schema, or `{ path, fields: [{ key, type, description }] }` for the caller's own fields.
 * Returns each field with the page and text it was read from. Read-only; nothing is stored except
 * an audit entry without the values. The page images are sent to xAI.
 */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const actor = await connectionActor(req);
  const { path, schema, fields } = parse(body, await req.json().catch(() => ({})));
  return ok(await extractFromConnection(actor, { connectionId: (await ctx.params).id, path, schema, fields }));
});
