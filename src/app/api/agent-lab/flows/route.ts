import { z } from 'zod';
import { created, handle, ok, parse } from '@/lib/http';
import { createFlow, listFlows } from '@/lib/flows-store/service';
import { flowsRequestContext } from './_shared';

export const dynamic = 'force-dynamic';

/** Workflows you own (platform admins see all of them). */
export const GET = handle(async (req) => {
  const { actor } = await flowsRequestContext(req);
  return ok({ flows: await listFlows(actor) });
});

const createBody = z.object({ definition: z.unknown() });

/** Saves a new workflow as a draft at version 1. The caller becomes its owner. */
export const POST = handle(async (req) => {
  const { actor } = await flowsRequestContext(req);
  const { definition } = parse(createBody, await req.json());
  return created({ flow: await createFlow(actor, definition) });
});
