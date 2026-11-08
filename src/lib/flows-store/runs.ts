import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { ApiError } from '@/lib/http';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import { BudgetMeter } from '@/lib/capabilities/gateway';
import type { PolicyContext } from '@/lib/capabilities/types';
import { analyzeFlow } from '@/lib/flows/analyze';
import { executeRun } from '@/lib/flows/runner';
import { createLiveExecutors, type RunUsage } from '@/lib/flows-live/executors';
import { createPrismaRunStore } from './run-store';
import { loadFlow, type Actor } from './service';

// Starting and reading real runs of published flows. Runs happen in-process for now (the runner is a
// pure function of stored state, so it can move to a worker later). Every step is saved as it
// finishes. Access follows the flow: its owner or a platform admin.

export type StartRunOptions = {
  inputs?: Record<string, unknown>;
  /** Same key + same flow = same run. A repeat returns the existing run and starts nothing. */
  idempotencyKey?: string;
  estimateAgentCostUsd?: (model?: string) => number;
};

const num = (d: { toString(): string }) => Number(d.toString());

function runSummary(r: { id: string; flow_id: string; version_id: string; trigger: string; status: string; error: string | null; triggered_by: string | null; total_tokens: number; cost_usd: { toString(): string }; started_at: Date | null; finished_at: Date | null; created_at: Date }) {
  return {
    id: r.id,
    flowId: r.flow_id,
    versionId: r.version_id,
    trigger: r.trigger,
    status: r.status,
    error: r.error,
    triggeredBy: r.triggered_by,
    totalTokens: r.total_tokens,
    costUsd: num(r.cost_usd),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
  };
}

export async function startRun(actor: Actor, policy: PolicyContext, flowId: string, opts: StartRunOptions = {}) {
  const flow = await loadFlow(flowId, actor);
  if (flow.status !== 'active') throw new ApiError(409, 'Only a published automation can run. Publish it first');
  const version = flow.current_version_id ? await prisma.platformFlowVersion.findUnique({ where: { id: flow.current_version_id } }) : null;
  if (!version) throw new ApiError(409, 'This automation has no saved version');

  // Permissions and policy are re-checked now, for the person starting the run, not trusted from publish time.
  const analysis = await analyzeFlow(version.definition, { registry: builtinCapabilityRegistry, policy, estimateAgentCostUsd: opts.estimateAgentCostUsd });
  if (!analysis.ok) throw new ApiError(422, 'The definition is not valid', { issues: analysis.issues });
  const errors = analysis.findings.filter((f) => f.severity === 'error');
  if (errors.length) throw new ApiError(422, 'This automation is blocked by policy checks', { findings: errors });

  const key = opts.idempotencyKey?.trim() || undefined;
  if (key) {
    const existing = await prisma.platformFlowRun.findFirst({ where: { flow_id: flowId, idempotency_key: key } });
    if (existing) return { ...runSummary(existing), reused: true };
  }

  let run;
  try {
    run = await prisma.platformFlowRun.create({
      data: {
        org_id: actor.orgId,
        flow_id: flowId,
        version_id: version.id,
        trigger: 'manual',
        status: 'queued',
        inputs: (opts.inputs ?? {}) as Prisma.InputJsonValue,
        triggered_by: actor.userId,
        idempotency_key: key ?? null,
      },
    });
  } catch (e) {
    // Two requests with the same key raced: the unique index lets one through, the other gets that run.
    if (key && (e as { code?: string }).code === 'P2002') {
      const existing = await prisma.platformFlowRun.findFirst({ where: { flow_id: flowId, idempotency_key: key } });
      if (existing) return { ...runSummary(existing), reused: true };
    }
    throw e;
  }

  await writeAudit({ actorId: actor.userId, action: 'flow.run.started', entityType: 'flow', entityId: flowId, after: { runId: run.id, version: version.version } });

  const final = await driveRun(actor, flowId, run, analysis, opts.inputs ?? {});
  return { ...runSummary(final), reused: false };
}

type Analysed = Extract<Awaited<ReturnType<typeof analyzeFlow>>, { ok: true }>;
type RunRow = NonNullable<Awaited<ReturnType<typeof prisma.platformFlowRun.findUnique>>>;

/**
 * Runs (or resumes) a run to its next stop and records usage. Resuming seeds cost and tokens from the
 * run row so the budget covers the whole run, not just this stretch.
 */
async function driveRun(actor: Actor, flowId: string, run: RunRow, analysis: Analysed, inputs: Record<string, unknown>): Promise<RunRow> {
  const store = createPrismaRunStore(run.id);
  const usage: RunUsage = { tokens: run.total_tokens, costUsd: num(run.cost_usd) };
  const meter = new BudgetMeter(analysis.flow.budget?.maxCostUsd);
  try {
    if (usage.costUsd > 0) meter.charge(usage.costUsd, 'earlier steps');
  } catch {
    // Already over budget: the agent executor refuses to spend more.
  }
  let status: string;
  try {
    status = await executeRun({ flow: analysis.flow, order: analysis.order, inputs, store, executors: createLiveExecutors({ actor, meter, usage }) });
  } catch (e) {
    // The runner reports step failures itself; this is an unexpected crash. Never leave a run "running".
    const message = e instanceof Error ? e.message : String(e);
    await store.setRunStatus('failed', message);
    status = 'failed';
  }
  await prisma.platformFlowRun.update({ where: { id: run.id }, data: { total_tokens: usage.tokens, cost_usd: usage.costUsd } });
  await writeAudit({ actorId: actor.userId, action: 'flow.run.finished', entityType: 'flow', entityId: flowId, after: { runId: run.id, status, tokens: usage.tokens, costUsd: usage.costUsd } });
  return (await prisma.platformFlowRun.findUnique({ where: { id: run.id } })) ?? run;
}

export type ApprovalDecision = { stepId: string; decision: 'approve' | 'reject'; comment?: string; estimateAgentCostUsd?: (model?: string) => number };

/**
 * Decides a paused approval step. Who may decide: a platform admin; the step's assignee (matched by
 * email); or, when no assignee is set, the flow owner. Someone who may see the run but not decide
 * gets 403; anyone else gets 404. The run resumes under the approver's own permissions, which are
 * checked again. Approve continues from the next step. Reject fails the run and skips the rest.
 */
export async function decideApproval(actor: Actor, policy: PolicyContext, flowId: string, runId: string, d: ApprovalDecision) {
  const flow = await prisma.platformFlow.findUnique({ where: { id: flowId } });
  const run = await prisma.platformFlowRun.findUnique({ where: { id: runId } });
  if (!flow || flow.org_id !== actor.orgId || !run || run.flow_id !== flowId) throw new ApiError(404, 'Run not found');
  const version = await prisma.platformFlowVersion.findUnique({ where: { id: run.version_id } });
  const analysis = version ? await analyzeFlow(version.definition, { registry: builtinCapabilityRegistry, policy, estimateAgentCostUsd: d.estimateAgentCostUsd }) : null;
  if (!analysis?.ok) throw new ApiError(409, 'This run\'s version can no longer be read');

  const step = analysis.flow.steps.find((s) => s.id === d.stepId);
  const saved = (await createPrismaRunStore(runId).loadStepRuns()).find((s) => s.stepId === d.stepId);
  const isAdmin = actor.role === 'platform_admin';
  const isOwner = flow.owner === actor.userId;
  const assignee = step?.type === 'approval' ? step.config.assignee?.trim().toLowerCase() : undefined;
  const me = assignee ? (await prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } }))?.email?.toLowerCase() : undefined;
  const isAssignee = !!assignee && me === assignee;
  if (!isAdmin && !isOwner && !isAssignee) throw new ApiError(404, 'Run not found');
  if (!isAdmin && !(assignee ? isAssignee : isOwner)) throw new ApiError(403, 'Only the assigned approver can decide this step');

  if (step?.type !== 'approval' || saved?.status !== 'waiting_approval' || run.status !== 'waiting_approval') {
    throw new ApiError(409, 'This step is not waiting for approval');
  }
  const errors = analysis.findings.filter((f) => f.severity === 'error');
  if (d.decision === 'approve' && errors.length) throw new ApiError(422, 'This automation is blocked by policy checks', { findings: errors });

  // One decision wins: the run leaves `waiting_approval` atomically, so a second click gets 409.
  const claimed = await prisma.platformFlowRun.updateMany({ where: { id: runId, status: 'waiting_approval' }, data: { status: 'running' } });
  if (claimed.count === 0) throw new ApiError(409, 'This step is not waiting for approval');

  const store = createPrismaRunStore(runId);
  const comment = d.comment?.trim().slice(0, 1000) || undefined;
  await writeAudit({ actorId: actor.userId, action: 'flow.approval.decided', entityType: 'flow', entityId: flowId, after: { runId, stepId: d.stepId, decision: d.decision, hasComment: !!comment } });

  if (d.decision === 'reject') {
    await store.saveStepRun({ stepId: d.stepId, status: 'failed', attempt: saved.attempt, error: `Rejected${comment ? `: ${comment}` : ''}` });
    const done = new Set((await store.loadStepRuns()).filter((s) => s.status === 'succeeded' || s.status === 'failed').map((s) => s.stepId));
    for (const id of analysis.order) {
      if (!done.has(id)) await store.saveStepRun({ stepId: id, status: 'skipped', attempt: 0, skipReason: `approval "${d.stepId}" was rejected` });
    }
    await store.setRunStatus('failed', `approval "${d.stepId}" was rejected`);
    await writeAudit({ actorId: actor.userId, action: 'flow.run.finished', entityType: 'flow', entityId: flowId, after: { runId, status: 'failed' } });
    return runSummary((await prisma.platformFlowRun.findUnique({ where: { id: runId } })) ?? run);
  }

  await store.saveStepRun({ stepId: d.stepId, status: 'succeeded', attempt: saved.attempt, output: { approved: true, by: actor.userId, at: new Date().toISOString(), ...(comment ? { comment } : {}) } });
  const inputs = (run.inputs && typeof run.inputs === 'object' && !Array.isArray(run.inputs) ? run.inputs : {}) as Record<string, unknown>;
  return runSummary(await driveRun(actor, flowId, run, analysis, inputs));
}

export async function listRuns(actor: Actor, flowId: string) {
  await loadFlow(flowId, actor);
  const rows = await prisma.platformFlowRun.findMany({ where: { flow_id: flowId }, orderBy: { created_at: 'desc' }, take: 50 });
  return rows.map(runSummary);
}

export async function getRun(actor: Actor, flowId: string, runId: string) {
  await loadFlow(flowId, actor);
  const run = await prisma.platformFlowRun.findUnique({ where: { id: runId }, include: { steps: true } });
  if (!run || run.flow_id !== flowId) throw new ApiError(404, 'Run not found');
  return {
    ...runSummary(run),
    inputs: run.inputs,
    steps: run.steps.map((s) => ({
      stepId: s.step_id,
      status: s.status,
      attempts: s.attempt,
      output: s.status === 'skipped' ? undefined : s.output,
      skipReason: s.status === 'skipped' ? ((s.output as { skipReason?: string } | null)?.skipReason ?? undefined) : undefined,
      error: s.error,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
    })),
  };
}
