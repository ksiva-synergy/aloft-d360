import 'server-only';

import prisma from '@/lib/db';
import { Prisma } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlatformAgentRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_class: string;
  template_id: string | null;
  status: string;
  environment: string;
  routing_mode: string;
  data_level: number | null;
  kb_namespace: string | null;
  thread_policy: string | null;
  retrieval_scope: string | null;
  commissioned_by: string;
  last_activity: Date | null;
  created_at: Date;
  updated_at: Date;
  _count?: { runs: number };
};

export type CreateAgentInput = {
  name: string;
  slug: string;
  description?: string;
  agent_class: string;
  template_id?: string;
  routing_mode?: string;
  data_level?: number;
  kb_namespace?: string;
  thread_policy?: string;
  retrieval_scope?: string;
  commissioned_by: string;
};

export type UpdateAgentInput = Partial<
  Pick<CreateAgentInput, 'name' | 'description' | 'routing_mode' | 'data_level'>
> & {
  status?: 'draft' | 'staging' | 'live' | 'degraded';
  environment?: 'development' | 'staging' | 'production';
  last_activity?: Date;
};

// ─── Typed error ──────────────────────────────────────────────────────────────

export class PlatformError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

// ─── Org helpers ──────────────────────────────────────────────────────────────

export async function getOrCreateOrg(
  clerkOrgId: string,
  name: string,
  slug: string,
) {
  return prisma.platformOrg.upsert({
    where: { clerk_org_id: clerkOrgId },
    create: { clerk_org_id: clerkOrgId, name, slug },
    update: { name },
  });
}

// Returns the single operating org for this POC.
// Determined by DEFAULT_ORG_SLUG env var — required in all environments.
// When real multi-tenant auth is added, org comes from session membership instead.
export async function getDefaultOrg() {
  const slug = process.env.DEFAULT_ORG_SLUG;
  if (!slug) {
    throw new Error(
      '[getDefaultOrg] DEFAULT_ORG_SLUG env var is not set. ' +
      'This is required for org resolution. See infra/context/deploy-notes.md.',
    );
  }
  return prisma.platformOrg.findFirstOrThrow({ where: { slug } });
}

// ─── Agent queries ────────────────────────────────────────────────────────────

export async function listAgents(orgId: string): Promise<PlatformAgentRow[]> {
  return prisma.platformAgent.findMany({
    where: { org_id: orgId },
    include: {
      _count: { select: { runs: true } },
    },
    orderBy: [
      { last_activity: { sort: 'desc', nulls: 'last' } },
      { created_at: 'desc' },
    ],
  });
}

export async function getAgent(
  orgId: string,
  agentId: string,
): Promise<PlatformAgentRow | null> {
  return prisma.platformAgent.findFirst({
    where: { id: agentId, org_id: orgId },
    include: {
      _count: { select: { runs: true } },
    },
  });
}

export async function createAgent(
  orgId: string,
  data: CreateAgentInput,
): Promise<PlatformAgentRow> {
  try {
    return await prisma.platformAgent.create({
      data: {
        org_id: orgId,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        agent_class: data.agent_class,
        template_id: data.template_id ?? null,
        routing_mode: data.routing_mode ?? 'auto',
        data_level: data.data_level ?? null,
        kb_namespace: data.kb_namespace ?? null,
        thread_policy: data.thread_policy ?? null,
        retrieval_scope: data.retrieval_scope ?? null,
        commissioned_by: data.commissioned_by,
      },
      include: {
        _count: { select: { runs: true } },
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new PlatformError(
        'SLUG_TAKEN',
        'An agent with this slug already exists',
      );
    }
    throw err;
  }
}

export async function updateAgent(
  orgId: string,
  agentId: string,
  data: UpdateAgentInput,
): Promise<PlatformAgentRow> {
  return prisma.platformAgent.update({
    where: {
      id: agentId,
      org_id: orgId,
    },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.routing_mode !== undefined && { routing_mode: data.routing_mode }),
      ...(data.data_level !== undefined && { data_level: data.data_level }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.environment !== undefined && { environment: data.environment }),
      ...(data.last_activity !== undefined && { last_activity: data.last_activity }),
    },
    include: {
      _count: { select: { runs: true } },
    },
  });
}

export async function archiveAgent(
  orgId: string,
  agentId: string,
): Promise<void> {
  await prisma.platformAgent.update({
    where: { id: agentId, org_id: orgId },
    data: { status: 'archived' },
  });
}

// ─── Meridian routing log (R7) ───────────────────────────────────────────────
// Fire-and-forget writes from the workbench chat route.
// Called with void (no await) — never blocks the SSE stream.

export type LogRoutingDecisionInput = {
  sessionId?: string | null;
  agentId?: string | null;
  step: string;
  classId?: string | null;
  complexity: string;
  modelId: string;
};

export async function logRoutingDecision(input: LogRoutingDecisionInput): Promise<void> {
  await prisma.platformRoutingDecision.create({
    data: {
      session_id: input.sessionId ?? null,
      agent_id: input.agentId ?? null,
      step: input.step,
      class_id: input.classId ?? null,
      complexity: input.complexity,
      model_id: input.modelId,
    },
  });
}

// ─── Agent manifest (R7) ─────────────────────────────────────────────────────

export type PlatformAgentManifestRow = {
  id: string;
  agent_id: string;
  session_id: string | null;
  config_ref: string | null;
  class_id: string | null;
  skill_ref: string | null;
  tool_ids: string[];
  schema_ref: string | null;
  eval_suite_id: string | null;
  rollback_ref: string | null;
  lineage_note: string | null;
  status: string;
  created_at: Date;
};

export type CreateManifestInput = {
  sessionId?: string | null;
  configRef?: string | null;
  classId?: string | null;
  skillRef?: string | null;
  toolIds?: string[];
  schemaRef?: string | null;
  evalSuiteId?: string | null;
  rollbackRef?: string | null;
  lineageNote?: string | null;
  status?: string;
};

export async function createManifest(
  agentId: string,
  input: CreateManifestInput,
): Promise<PlatformAgentManifestRow> {
  return prisma.platformAgentManifest.create({
    data: {
      agent_id: agentId,
      session_id: input.sessionId ?? null,
      config_ref: input.configRef ?? null,
      class_id: input.classId ?? null,
      skill_ref: input.skillRef ?? null,
      tool_ids: input.toolIds ?? [],
      schema_ref: input.schemaRef ?? null,
      eval_suite_id: input.evalSuiteId ?? null,
      rollback_ref: input.rollbackRef ?? null,
      lineage_note: input.lineageNote ?? null,
      status: input.status ?? 'active',
    },
  });
}

export async function getManifest(
  agentId: string,
): Promise<PlatformAgentManifestRow | null> {
  return prisma.platformAgentManifest.findFirst({
    where: { agent_id: agentId, status: 'active' },
    orderBy: { created_at: 'desc' },
  });
}

// ─── Run statistics ───────────────────────────────────────────────────────────

export async function getCallsToday(agentId: string): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  return prisma.platformAgentRun.count({
    where: {
      agent_id: agentId,
      created_at: { gte: startOfToday },
    },
  });
}
