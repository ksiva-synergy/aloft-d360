import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/http';
import { slugify } from '@/lib/catalog-helpers';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { analyzeFlow } from '@/lib/flows/analyze';
import { validateFlow } from '@/lib/flows/validate';

// Persistence for flow drafts and published versions. This is the only place the flow tables are
// touched; the flow core stays free of Prisma (enforced by flows/__tests__/boundary.test.ts).
//
// Access model: the creator owns a flow; a platform_admin can see and manage every flow. Nobody
// else can see it. Saved versions are immutable: an edit always inserts a new version.
// Status: `draft` (not runnable) or `active` (published). Saving a new version of an active flow
// returns it to `draft`, because the published version must be exactly what was checked.

export type Actor = { userId: string; role: string; orgId: string };

const isPlatformAdmin = (a: Actor) => a.role === 'platform_admin';

async function loadFlow(id: string, actor: Actor) {
  const flow = await prisma.platformFlow.findUnique({ where: { id } });
  // Same answer for "missing", "other org" and "not yours": no existence leak.
  if (!flow || flow.org_id !== actor.orgId || (flow.owner !== actor.userId && !isPlatformAdmin(actor))) {
    throw new ApiError(404, 'Automation not found');
  }
  return flow;
}

type FlowRow = { id: string; name: string; slug: string; owner: string; status: string; created_at: Date; updated_at: Date };

function toSummary(f: FlowRow, version?: number) {
  return { id: f.id, name: f.name, slug: f.slug, owner: f.owner, status: f.status, version, createdAt: f.created_at, updatedAt: f.updated_at };
}

function requireValid(definition: unknown) {
  const v = validateFlow(definition);
  if (!v.ok) throw new ApiError(422, 'The definition is not valid', { issues: v.issues });
  return v.flow;
}

export async function listFlows(actor: Actor) {
  const rows = await prisma.platformFlow.findMany({
    where: { org_id: actor.orgId, ...(isPlatformAdmin(actor) ? {} : { owner: actor.userId }) },
    orderBy: { updated_at: 'desc' },
    take: 200,
    include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } },
  });
  return rows.map((f) => toSummary(f, f.versions[0]?.version));
}

export async function createFlow(actor: Actor, definition: unknown) {
  const flow = requireValid(definition);
  const slug = `${slugify(flow.name) || 'flow'}-${Date.now().toString(36)}`;
  const created = await prisma.$transaction(async (tx) => {
    const f = await tx.platformFlow.create({ data: { org_id: actor.orgId, name: flow.name, slug, owner: actor.userId, status: 'draft' } });
    const v = await tx.platformFlowVersion.create({ data: { flow_id: f.id, version: 1, definition: flow as unknown as Prisma.InputJsonValue, created_by: actor.userId } });
    return tx.platformFlow.update({ where: { id: f.id }, data: { current_version_id: v.id } });
  });
  await writeAudit({ actorId: actor.userId, action: 'flow.created', entityType: 'flow', entityId: created.id, after: { name: flow.name, version: 1 } });
  return toSummary(created, 1);
}

export async function getFlow(actor: Actor, id: string) {
  const flow = await loadFlow(id, actor);
  const versions = await prisma.platformFlowVersion.findMany({ where: { flow_id: id }, orderBy: { version: 'desc' }, take: 50, select: { id: true, version: true, created_by: true, created_at: true } });
  const current = flow.current_version_id ? await prisma.platformFlowVersion.findUnique({ where: { id: flow.current_version_id } }) : null;
  return {
    ...toSummary(flow, current?.version),
    definition: current?.definition ?? null,
    versions: versions.map((v) => ({ id: v.id, version: v.version, createdBy: v.created_by, createdAt: v.created_at })),
  };
}

/**
 * Saves a new immutable version. `baseVersion` must equal the latest version, otherwise someone
 * else saved in between and the caller gets 409 instead of overwriting their work.
 */
export async function saveVersion(actor: Actor, id: string, definition: unknown, baseVersion: number) {
  const flow = await loadFlow(id, actor);
  const def = requireValid(definition);
  const latest = await prisma.platformFlowVersion.findFirst({ where: { flow_id: id }, orderBy: { version: 'desc' }, select: { version: true } });
  const latestNo = latest?.version ?? 0;
  if (baseVersion !== latestNo) throw new ApiError(409, 'This automation changed since you opened it', { latestVersion: latestNo });
  const next = latestNo + 1;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.platformFlowVersion.create({ data: { flow_id: id, version: next, definition: def as unknown as Prisma.InputJsonValue, created_by: actor.userId } });
      return tx.platformFlow.update({ where: { id }, data: { current_version_id: v.id, name: def.name, status: 'draft' } });
    });
    await writeAudit({ actorId: actor.userId, action: 'flow.version.saved', entityType: 'flow', entityId: id, before: { version: latestNo, status: flow.status }, after: { version: next } });
    return toSummary(updated, next);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new ApiError(409, 'This automation changed since you opened it', { latestVersion: latestNo + 1 });
    throw e;
  }
}

/**
 * Publishes the current version. The gate runs here, on the server: no policy errors for this
 * actor, and a simulation of this exact definition that succeeds (using the inputs and sample
 * responses supplied). A client cannot claim a passing simulation.
 */
export async function publishFlow(
  actor: Actor,
  policy: PolicyContext,
  id: string,
  opts: { version: number; inputs?: Record<string, unknown>; fixtures?: Record<string, unknown>; estimateAgentCostUsd?: (model?: string) => number },
) {
  const flow = await loadFlow(id, actor);
  const current = flow.current_version_id ? await prisma.platformFlowVersion.findUnique({ where: { id: flow.current_version_id } }) : null;
  if (!current) throw new ApiError(409, 'This automation has no saved version');
  if (current.version !== opts.version) throw new ApiError(409, 'Only the latest saved version can be published', { latestVersion: current.version });

  const analysis = await analyzeFlow(current.definition, {
    registry: builtinCapabilityRegistry,
    policy,
    estimateAgentCostUsd: opts.estimateAgentCostUsd,
    simulate: true,
    inputs: opts.inputs,
    fixtures: opts.fixtures,
  });
  if (!analysis.ok) throw new ApiError(422, 'The definition is not valid', { issues: analysis.issues });
  const errors = analysis.findings.filter((f) => f.severity === 'error');
  if (errors.length) throw new ApiError(422, 'Publishing is blocked by policy checks', { findings: errors });
  if (analysis.simulation?.status !== 'succeeded') {
    throw new ApiError(422, 'The simulated run did not succeed, so this version cannot be published', { simulation: analysis.simulation?.status, error: analysis.simulation?.error });
  }

  const updated = await prisma.platformFlow.update({ where: { id }, data: { status: 'active' } });
  await writeAudit({ actorId: actor.userId, action: 'flow.published', entityType: 'flow', entityId: id, after: { version: current.version, simulationCostUsd: analysis.simulation.totals.costUsd } });
  return toSummary(updated, current.version);
}

/** Returns a published flow to draft without deleting anything. */
export async function unpublishFlow(actor: Actor, id: string) {
  const flow = await loadFlow(id, actor);
  const updated = await prisma.platformFlow.update({ where: { id }, data: { status: 'draft' } });
  await writeAudit({ actorId: actor.userId, action: 'flow.unpublished', entityType: 'flow', entityId: id, before: { status: flow.status } });
  return toSummary(updated);
}

/** Deletes a flow and (by cascade) its versions. Refused while it has runs, to keep history. */
export async function deleteFlow(actor: Actor, id: string) {
  await loadFlow(id, actor);
  const runs = await prisma.platformFlowRun.count({ where: { flow_id: id } });
  if (runs > 0) throw new ApiError(409, 'This automation has run history and cannot be deleted');
  await prisma.platformFlow.delete({ where: { id } });
  await writeAudit({ actorId: actor.userId, action: 'flow.deleted', entityType: 'flow', entityId: id });
}
