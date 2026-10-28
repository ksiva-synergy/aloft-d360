import { handle, ok } from '@/lib/http';
import { listCatalogAgents } from '@/lib/agents/catalog';
import { assertFlowsEnabled, flowsRequestContext } from '../_shared';

export const dynamic = 'force-dynamic';

/** Saved agents an "Ask an agent" step can use, with whether each is ready for a published automation. */
export const GET = handle(async (req) => {
  assertFlowsEnabled();
  await flowsRequestContext(req);
  return ok({ agents: await listCatalogAgents() });
});
