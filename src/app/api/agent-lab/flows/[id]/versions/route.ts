import { z } from 'zod';
import { created, handle, parse } from '@/lib/http';
import { saveVersion } from '@/lib/flows-store/service';
import { flowsRequestContext } from '../../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ definition: z.unknown(), baseVersion: z.number().int().min(0) });

/** Saves a new immutable version. 409 if `baseVersion` is not the latest (someone saved in between). */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { actor } = await flowsRequestContext(req);
  const { definition, baseVersion } = parse(body, await req.json());
  return created({ flow: await saveVersion(actor, (await ctx.params).id, definition, baseVersion) });
});
