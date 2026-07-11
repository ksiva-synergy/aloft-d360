import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getDefaultOrg } from '@/lib/org';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { executeInspectorTool } from '@/lib/inspector/tools';
import { buildSystemPrompt, buildToolConfig } from '@/lib/inspector/prompts';
import { BOOST_SUITE_V1, BOOST_SUITE_V2, BOOST_SUITE_VERSION } from '@/lib/boost/suite';
import { BOOST_MODELS } from '@/lib/boost/models';
import { deriveCounts, BOOST_SCORE_VERSION } from '@/lib/boost/rank';
import { buildCtxInjectionBlock, resolveInjectionTableOrder } from '@/lib/boost/ctx-injection';
import { writeBanditObservation } from '@/lib/lifecycle/write-bandit-observation';
import { scoreSingleObservation } from '@/lib/lifecycle/judge-batch';
import { selectMemory, formatForInjection } from '@/lib/memory/retrieve';

export type BenchmarkRunParams = {
  caseId: string;
  modelKey: string;
  contextMode: 'harvested' | 'warehouse_only';
  memoryEnabled?: boolean;   // default false — AM2.2 memory arm toggle
};

export type BenchmarkRunResult = {
  ok: boolean;
  error?: string;
  row?: Record<string, unknown>;
};

export async function runBenchmarkCase(params: BenchmarkRunParams): Promise<BenchmarkRunResult> {
  const { caseId, modelKey, contextMode, memoryEnabled = false } = params;

  const boostCase = [...BOOST_SUITE_V1, ...BOOST_SUITE_V2].find(c => c.id === caseId);
  if (!boostCase) return { ok: false, error: `Case '${caseId}' not found in BOOST_SUITE_V1 or BOOST_SUITE_V2` };

  const boostModel = BOOST_MODELS.find(m => m.key === modelKey);
  if (!boostModel) return { ok: false, error: `Model key '${modelKey}' not found in BOOST_MODELS` };

  const orgId = getDefaultOrg().id;
  let systemPrompt = buildSystemPrompt(contextMode);
  const toolConfig = buildToolConfig(contextMode);
  const modelSupportsTools = boostModel.apiType === 'converse' || boostModel.apiType === 'foundry';

  // Short-circuit: models that cannot use tools write an 'incompatible' row immediately
  if (!modelSupportsTools) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (prisma.platform_boost_runs.create as any)({
        data: {
          org_id: orgId,
          suite_version: BOOST_SUITE_VERSION,
          case_id: boostCase.id,
          model_key: boostModel.key,
          model_provider: boostModel.provider,
          model_id: boostModel.modelId,
          context_mode: contextMode,
          outcome: 'incompatible',
          tool_trajectory: [],
          tool_calls_total: 0,
          tool_calls_catalog: 0,
          tool_calls_data: 0,
          tool_calls_discovery: 0,
          tool_calls_error: 0,
          input_tokens: 0,
          output_tokens: 0,
          loops: 0,
          latency_ms: 0,
          groundedness: null,
          semantic_score: null,
          semantic_detail: Prisma.JsonNull,
          answer_excerpt: null,
          agent_run_id: null,
          session_id: null,
          boost_score_version: BOOST_SCORE_VERSION,
          error_detail: `Model does not support tool use — excluded from benchmark matrix`,
          memory_enabled: memoryEnabled,
          injected_bullet_ids: [],
        },
      });
      return { ok: false, error: 'incompatible', row: row as unknown as Record<string, unknown> };
    } catch {
      return { ok: false, error: 'incompatible' };
    }
  }

  const startTime = Date.now();

  let inputTokens = 0;
  let outputTokens = 0;
  let loops = 0;
  let answerExcerpt: string | null = null;
  let toolTrajectory: unknown[] = [];
  let injectedBulletIds: string[] = [];

  try {
    // ── CTX arm: pre-inject catalog cards ──────────────────────────────────────
    // SQL arm (warehouse_only) receives no injection — zero catalog context.
    if (contextMode === 'harvested') {
      const ctxBlock = await buildCtxInjectionBlock(boostCase, orgId);
      if (ctxBlock) {
        systemPrompt = ctxBlock + '\n\n' + systemPrompt;
      }
    }

    // ── Memory arm: inject operating-memory bullets (AM2.2) ────────────────────
    // Runs after CTX injection so memory bullets are prepended on top of the
    // already-assembled system prompt, matching the production injection order
    // used in the workbench (memory block → CTX block → base prompt).
    // Agent class defaults to 'feynman' — the highest-volume synthesis class
    // and the one most likely to have bullets from AM1 synthesis. BoostCase has
    // no agentClass field; 'feynman' gives the most realistic signal.
    if (memoryEnabled) {
      const bullets = await selectMemory(orgId, boostCase.agentClass ?? 'feynman', boostCase.prompt);
      if (bullets.length > 0) {
        injectedBulletIds = bullets.map(b => b.id);
        const memBlock = formatForInjection(bullets);
        systemPrompt = memBlock + '\n\n' + systemPrompt;
      }
    }

    // ── phantom_trace annotation wrapper ───────────────────────────────────────
    // When groundednessMode is 'phantom_trace', the scorer (groundedness.ts) receives
    // the entire toolTrajectory as JSON and an LLM auditor checks every quantitative
    // claim against tool results (scoreGroundedness → PHANTOM_TRACE_PROMPT). The
    // auditor sees all fields on each trajectory entry, so a 'phantomCatalogCall: true'
    // flag on describe_schema entries whose path was already pre-injected gives the
    // scorer visible signal that the model redundantly re-discovered injected context
    // rather than trusting the pre-injection. This does not change scorer logic — it
    // only enriches the trajectory JSON that the scorer already serializes wholesale.
    const injectedPaths: Set<string> =
      contextMode === 'harvested' && (boostCase.groundednessMode ?? 'phantom_trace') === 'phantom_trace'
        ? new Set(resolveInjectionTableOrder(boostCase))
        : new Set();

    const wrappedExecuteTool = (toolName: string, toolInput: Record<string, unknown>, callId: string): Promise<string> => {
      if (
        injectedPaths.size > 0 &&
        toolName === 'describe_schema' &&
        toolInput.action === 'describe'
      ) {
        const calledPath = typeof toolInput.path === 'string' ? toolInput.path : null;
        if (calledPath && injectedPaths.has(calledPath)) {
          // Mark as phantom: model called describe_schema on a table whose card was
          // already pre-injected in the system prompt. The scorer sees this flag in
          // the serialized trajectory (toolTrajectory JSON passed to scoreGroundedness).
          return executeInspectorTool(toolName, { ...toolInput, phantomCatalogCall: true }, callId);
        }
      }
      return executeInspectorTool(toolName, toolInput, callId);
    };

    const result = await dispatchAgentLoop(boostModel, {
      modelId: boostModel.modelId,
      systemPrompt,
      messages: [{ role: 'user', content: [{ text: boostCase.prompt }] }],
      tools: toolConfig,
      executeTool: (toolName, toolInput, callId) => wrappedExecuteTool(toolName, toolInput, callId),
      maxLoops: 8,
      supportsTools: true,
      supportsThinking: boostModel.modelId.includes('anthropic'),
    });

    inputTokens = result.usage.inputTokens;
    outputTokens = result.usage.outputTokens;
    loops = result.loops;
    answerExcerpt = result.finalText ? result.finalText.slice(0, 500) : null;
    toolTrajectory = result.toolCalls;

    const latencyMs = Date.now() - startTime;
    const counts = deriveCounts(result.toolCalls);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (prisma.platform_boost_runs.create as any)({
      data: {
        org_id: orgId,
        suite_version: BOOST_SUITE_VERSION,
        case_id: boostCase.id,
        model_key: boostModel.key,
        model_provider: boostModel.provider,
        model_id: boostModel.modelId,
        context_mode: contextMode,
        outcome: result.outcome,
        tool_trajectory: toolTrajectory as object[],
        tool_calls_total: counts.total,
        tool_calls_catalog: counts.catalog,
        tool_calls_data: counts.data,
        tool_calls_discovery: counts.discovery,
        tool_calls_error: counts.error,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        loops,
        latency_ms: latencyMs,
        groundedness: null,
        semantic_score: null,
        semantic_detail: Prisma.JsonNull,
        answer_excerpt: answerExcerpt,
        answer_full: result.finalText ?? null,
        agent_run_id: null,
        session_id: null,
        boost_score_version: BOOST_SCORE_VERSION,
        error_detail: result.errorDetail ?? null,
        memory_enabled: memoryEnabled,
        injected_bullet_ids: injectedBulletIds,
      },
    });

    // Write bandit observation for the boost run (C + T immediate; S + G via post-hoc score API)
    writeBanditObservation({
      source: 'boost',
      sourceRunId: row.id,
      modelId: boostModel.modelId,
      provider: boostModel.provider,
      sheetType: `boost_${boostCase.id}`,
      answerFull: result.finalText ?? null,
      toolTrajectory,
      inputTokens,
      outputTokens,
      toolCallsTotal: counts.total,
      toolCallsError: counts.error,
      toolCallsDiscovery: counts.discovery,
      durationMs: latencyMs,
      outcome: result.outcome as 'completed' | 'truncated' | 'errored',
      groundednessMode: boostCase.groundednessMode ?? 'phantom_trace',
    }).then(obsId => {
      if (obsId) scoreSingleObservation(obsId).catch(() => {});
    }).catch(() => {});

    return { ok: true, row: row as unknown as Record<string, unknown> };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Benchmark run failed';
    const latencyMs = Date.now() - startTime;
    const counts = deriveCounts(toolTrajectory as { kind: 'catalog' | 'data' | 'discovery' | 'error' }[]);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (prisma.platform_boost_runs.create as any)({
        data: {
          org_id: orgId,
          suite_version: BOOST_SUITE_VERSION,
          case_id: boostCase.id,
          model_key: boostModel.key,
          model_provider: boostModel.provider,
          model_id: boostModel.modelId,
          context_mode: contextMode,
          outcome: 'errored',
          tool_trajectory: toolTrajectory as object[],
          tool_calls_total: counts.total,
          tool_calls_catalog: counts.catalog,
          tool_calls_data: counts.data,
          tool_calls_discovery: counts.discovery,
          tool_calls_error: counts.error,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          loops,
          latency_ms: latencyMs,
          groundedness: null,
          semantic_score: null,
          semantic_detail: Prisma.JsonNull,
          answer_excerpt: answerExcerpt,
          agent_run_id: null,
          session_id: null,
          boost_score_version: BOOST_SCORE_VERSION,
          error_detail: msg,
          memory_enabled: memoryEnabled,
          injected_bullet_ids: injectedBulletIds,
        },
      });
      // Write errored bandit observation (no S/G judging for errored runs)
      writeBanditObservation({
        source: 'boost',
        sourceRunId: row.id,
        modelId: boostModel.modelId,
        provider: boostModel.provider,
        sheetType: `boost_${boostCase.id}`,
        answerFull: answerExcerpt,
        toolTrajectory,
        inputTokens,
        outputTokens,
        toolCallsTotal: counts.total,
        toolCallsError: counts.error,
        toolCallsDiscovery: counts.discovery,
        durationMs: latencyMs,
        outcome: 'errored',
        groundednessMode: boostCase.groundednessMode ?? 'phantom_trace',
      }).catch(() => {});
      return { ok: false, error: msg, row: row as unknown as Record<string, unknown> };
    } catch {
      return { ok: false, error: msg };
    }
  }
}
