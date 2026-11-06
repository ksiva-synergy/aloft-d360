import { ApiError } from '@/lib/http';
import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { getDefaultOrg } from '@/lib/org';
import { computeCostUsd } from '@/lib/lifecycle/log-agent-cost';
import type { PolicyContext } from '@/lib/capabilities/types';
import { CAPABILITY_PERMISSIONS } from '@/lib/capabilities/builtin';
import { RAW_SQL_PERMISSION } from '@/lib/flows/policy';
import type { Actor } from '@/lib/flows-store/service';
import { agentStatusMap } from '@/lib/agents/catalog';
import { listKnowledgeBases, type KnowledgeBaseSummary } from '@/lib/knowledge/service';

// Shared by the Flows preview routes. Not a route file: Next only routes `route.ts`.

/**
 * Platform admins hold every Studio capability permission without needing the permission rows
 * seeded (decision 2026-10-27: creators own their flows, platform admins can do everything).
 * Everyone else gets exactly the permissions their roles carry.
 */
const PLATFORM_ADMIN_GRANTS = [...Object.values(CAPABILITY_PERMISSIONS), RAW_SQL_PERMISSION];

/**
 * Always-enforced auth (not tied to INSPECTOR_AUTH_ENFORCE). `inspector:use` is enough to use the
 * preview and to save drafts; capability permissions are reported as publish-blocking findings.
 */
export async function flowsRequestContext(req: Request): Promise<{ policy: PolicyContext; actor: Actor; knowledge?: KnowledgeBaseSummary[] }> {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.INSPECTOR_USE);
  const orgId = getDefaultOrg().id;
  const permissions = new Set(auth.permissions);
  if (auth.role === 'platform_admin') PLATFORM_ADMIN_GRANTS.forEach((p) => permissions.add(p));
  // Saved agents and their status, so agent steps are checked; if they cannot be loaded the check is skipped.
  const agents = await agentStatusMap().catch((e: unknown) => {
    console.warn('[flows] agent catalog unavailable:', e instanceof Error ? e.message.slice(0, 200) : e);
    return undefined;
  });
  // Knowledge bases this person may search, so Search knowledge steps are checked; skipped if unavailable.
  const knowledge = await listKnowledgeBases({ userId: auth.userId, role: auth.role, orgId }).catch((e: unknown) => {
    console.warn('[flows] knowledge bases unavailable:', e instanceof Error ? e.message.slice(0, 200) : e);
    return undefined;
  });
  const knowledgeBases = knowledge && new Map(knowledge.map((k) => [k.id, { name: k.name, archived: k.archived }]));
  return {
    policy: { actorId: auth.userId, tenantId: orgId, permissions, egress: { emailDomains: emailDomainAllowlist() }, agents, knowledgeBases },
    actor: { userId: auth.userId, role: auth.role, orgId },
    knowledge,
  };
}

export async function flowsPolicyContext(req: Request): Promise<PolicyContext> {
  return (await flowsRequestContext(req)).policy;
}

/** FLOWS_EGRESS_EMAIL_DOMAINS (comma-separated). Defaults to the reserved example.com domain only. */
export function emailDomainAllowlist(): string[] {
  const raw = process.env.FLOWS_EGRESS_EMAIL_DOMAINS ?? 'example.com';
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/** Planning assumption for one agent step: 6k input and 1k output tokens, priced by ALOFT's table. */
export const AGENT_STEP_TOKENS = { input: 6000, output: 1000 };
export const estimateAgentCostUsd = (model?: string) => computeCostUsd(model ?? 'claude-sonnet-4', AGENT_STEP_TOKENS.input, AGENT_STEP_TOKENS.output);

export const PUBLISHING_STATUS = {
  available: true,
  reason: 'Save the automation, then publish it once it passes every check and a simulated run.',
} as const;
