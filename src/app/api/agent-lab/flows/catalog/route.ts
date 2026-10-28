import { handle, ok } from '@/lib/http';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import { FLOW_TEMPLATES } from '@/lib/flows/templates';
import { recommendTemplates } from '@/lib/flows/recommend';
import { flowsPolicyContext, PUBLISHING_STATUS } from '../_shared';

export const dynamic = 'force-dynamic';

/** Capability catalog (L0), starter templates and, with `?goal=`, the templates that match a goal. */
export const GET = handle(async (req) => {
  const policy = await flowsPolicyContext(req);
  const goal = new URL(req.url).searchParams.get('goal')?.slice(0, 500) ?? '';
  return ok({
    capabilities: builtinCapabilityRegistry.list(),
    templates: FLOW_TEMPLATES,
    matches: goal ? recommendTemplates(goal, FLOW_TEMPLATES) : [],
    egress: policy.egress,
    publishing: PUBLISHING_STATUS,
  });
});
