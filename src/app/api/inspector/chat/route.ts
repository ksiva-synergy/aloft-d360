import { NextRequest } from 'next/server';
import { type Message, type ContentBlock } from '@aws-sdk/client-bedrock-runtime';
import { logAgentCost } from '@/lib/lifecycle/log-agent-cost';
import { scoreRun } from '@/lib/lifecycle/score-run';
import { reportToBandit } from '@/lib/lifecycle/report-bandit';
import { writeBanditObservation } from '@/lib/lifecycle/write-bandit-observation';
import { scoreSingleObservation } from '@/lib/lifecycle/judge-batch';
import { evaluateTrajectoryReflection } from '@/lib/marcus/inspectorReflect';
import { evaluateInspectorFirstTurn } from '@/lib/marcus/reflect';
import { executeInspectorTool, resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { buildSystemPrompt, buildToolConfig, buildInsightsContext } from '@/lib/inspector/prompts';
import { runAgentLoop } from '@/lib/inspector/agent-loop';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { BOOST_MODELS } from '@/lib/boost/models';
import { openSession } from '@/lib/memory/trace';
import { getDefaultOrg } from '@/lib/org';
import { getDefaultOrg as getDefaultOrgAsync } from '@/lib/platform/agents';
import {
  isMemoryInjectionEnabled,
  selectMemoryAll,
  formatForInjection,
  MemoryPhase,
} from '@/lib/memory/retrieve';
import { recordInjection, attributeRunOutcome, type InjectedBullet } from '@/lib/memory/attribution';
import { getCurrentTopicMap } from '@/lib/foer/topics';
import { buildSemanticContext, type SemanticContext } from '@/lib/semantic/context-builder';
import { guardInspectorChat } from '@/lib/inspector/session-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(v: string): boolean { return UUID_RE.test(v); }

// Cross-turn correction state: maps sessionId → last DEAD_END nodeId when the
// final tool of a turn errored. Cleared on the next turn for that session.
// In-memory only (instance-local on Vercel); acceptable for AM0.3.
const pendingCorrectionNodeBySession = new Map<string, string>();

const MODELS_MAP: Record<string, { bedrockId: string; foundryDeployment?: string; supportsTools: boolean; supportsThinking: boolean }> = {
  // ── Bedrock (keys match AVAILABLE_MODELS in workbench/types.ts) ─────────────
  'opus-4-6':         { bedrockId: 'us.anthropic.claude-opus-4-6-v1',             supportsTools: true,  supportsThinking: true  },
  'sonnet-4-6':       { bedrockId: 'us.anthropic.claude-sonnet-4-6',               supportsTools: true,  supportsThinking: true  },
  'haiku-4-5':        { bedrockId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',  supportsTools: true,  supportsThinking: false },
  'nova-premier':     { bedrockId: 'us.amazon.nova-pro-v1:0',                      supportsTools: true,  supportsThinking: false },
  'nova-pro':         { bedrockId: 'us.amazon.nova-pro-v1:0',                      supportsTools: true,  supportsThinking: false },
  'nova-lite':        { bedrockId: 'us.amazon.nova-lite-v1:0',                     supportsTools: true,  supportsThinking: false },
  'nova-micro':       { bedrockId: 'us.amazon.nova-micro-v1:0',                    supportsTools: true,  supportsThinking: false },
  'llama-4-maverick': { bedrockId: 'us.meta.llama4-maverick-17b-instruct-v1:0',    supportsTools: false, supportsThinking: false },
  'llama-4-scout':    { bedrockId: 'us.meta.llama4-scout-17b-instruct-v1:0',       supportsTools: false, supportsThinking: false },
  'llama-3-3-70b':    { bedrockId: 'us.meta.llama3-3-70b-instruct-v1:0',           supportsTools: false, supportsThinking: false },
  'deepseek-r1':      { bedrockId: 'us.deepseek.r1-v1:0',                          supportsTools: false, supportsThinking: true  },
  'mistral-l3':       { bedrockId: 'mistral.mistral-large-3-675b-instruct',         supportsTools: true,  supportsThinking: false },
  'qwen3-32b':        { bedrockId: 'qwen.qwen3-32b-v1:0',                           supportsTools: true,  supportsThinking: false },
  // ── Azure AI Foundry ────────────────────────────────────────────────────────
  'gpt-5-4':          { bedrockId: '', foundryDeployment: 'gpt-5.4-PBC',   supportsTools: true,  supportsThinking: false },
  'grok-4-3':         { bedrockId: '', foundryDeployment: 'grok-4.3-PBC',  supportsTools: true,  supportsThinking: false },
  'kimi-k2-6':        { bedrockId: '', foundryDeployment: 'kimi-k2-6-PBC', supportsTools: true,  supportsThinking: false },
  'deepseek-v4':      { bedrockId: '', foundryDeployment: 'DeepSeek-V4-Pro', supportsTools: true, supportsThinking: true  },
  // ── Legacy keys (backward compat with old client code) ─────────────────────
  'claude-opus':      { bedrockId: 'us.anthropic.claude-opus-4-6-v1',             supportsTools: true,  supportsThinking: true  },
  'claude-sonnet':    { bedrockId: 'us.anthropic.claude-sonnet-4-6',               supportsTools: true,  supportsThinking: true  },
  'claude-haiku':     { bedrockId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',  supportsTools: true,  supportsThinking: false },
  'mistral-large-3':  { bedrockId: 'mistral.mistral-large-3-675b-instruct',         supportsTools: true,  supportsThinking: false },
};

const DEFAULT_MODEL_KEY = 'sonnet-4-6';

function resolveModel(key?: string) {
  return key && MODELS_MAP[key] ? MODELS_MAP[key] : MODELS_MAP[DEFAULT_MODEL_KEY];
}

function inferProvider(modelId: string): string {
  if (modelId.startsWith('us.anthropic') || modelId.startsWith('us.amazon') ||
      modelId.startsWith('us.meta') || modelId.startsWith('us.deepseek') ||
      modelId.startsWith('mistral') || modelId.startsWith('qwen')) {
    return 'bedrock';
  }
  if (modelId === '') return 'azure'; // Foundry models resolved via foundryDeployment
  return 'azure';
}

function isBedrockConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function extractSuggestionsFromText(text: string): string[] {
  const lines = text.split('\n');
  const results: string[] = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lc = line.toLowerCase();
    if (lc.includes('you might') || lc.includes('next step') || lc.includes('follow-up') || lc.includes('you could') || lc.includes('try:') || lc.includes('options:')) {
      inBlock = true;
      continue;
    }
    if (inBlock || i >= lines.length - 8) {
      const m = line.match(/^[-*•]\s+(.+)/) || line.match(/^\d+\.\s+(.+)/);
      if (m) {
        const txt = m[1].trim().replace(/[.:]$/, '');
        if (txt.length >= 5 && txt.length <= 80) results.push(txt);
      } else if (inBlock && line.length > 0 && !line.match(/^[-*•\d]/)) {
        if (results.length > 0) inBlock = false;
      }
    }
  }
  return results.slice(0, 3);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    sessionId?: string;
    messages?: { role: string; content: string }[];
    model?: string;
    contextMode?: 'harvested' | 'warehouse_only';
  };

  // ── D1: session-ownership guard (behind INSPECTOR_AUTH_ENFORCE) ─────────────
  // Observe mode (default) logs would-be rejections and serves normally; enforce
  // mode returns 401 (anon) / 403 (ownership mismatch). Non-interactive callers
  // authenticate via INSPECTOR_SERVICE_TOKEN and bypass the ownership check.
  const authBlock = await guardInspectorChat(request, body.sessionId);
  if (authBlock) return authBlock;

  if (!isBedrockConfigured()) {
    return cannedResponse(request);
  }

  const contextMode: 'harvested' | 'warehouse_only' = body.contextMode === 'warehouse_only' ? 'warehouse_only' : 'harvested';

  const modelConfig = resolveModel(body.model);
  const isFoundryModel = !!modelConfig.foundryDeployment;
  const modelId = modelConfig.bedrockId;
  const effectiveModelId = modelConfig.foundryDeployment || modelConfig.bedrockId;

  const filteredMessages: Message[] = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content } as ContentBlock],
    }));

  // Merge consecutive same-role messages
  const userMessages: Message[] = [];
  for (const msg of filteredMessages) {
    if (userMessages.length === 0 || userMessages[userMessages.length - 1].role !== msg.role) {
      userMessages.push(msg);
    } else {
      const last = userMessages[userMessages.length - 1];
      const lastText = (last.content?.[0] as { text?: string })?.text || '';
      const curText = (msg.content?.[0] as { text?: string })?.text || '';
      last.content = [{ text: lastText + '\n' + curText } as ContentBlock];
    }
  }

  if (userMessages.length === 0) {
    return new Response('No messages provided', { status: 400 });
  }

  // ── S4: Semantic context (governed entities) ──────────────────────────────────
  // Resolve once at session init — passed to tool context and system prompt.
  let semanticCtx: SemanticContext | undefined;
  let resolvedConnectionId: string | null = null;
  try {
    const org = await getDefaultOrgAsync();
    const catalogEntry = await resolveToolCatalogEntry('');
    resolvedConnectionId = (catalogEntry?.config as Record<string, string> | null)?.connection_id ?? null;
    if (resolvedConnectionId) {
      semanticCtx = await buildSemanticContext(org.id, resolvedConnectionId);
    }
  } catch { /* non-fatal — fall back to no semantic context */ }

  const toolConfig = buildToolConfig(contextMode, !!(semanticCtx && semanticCtx.entities.length > 0));
  const basePrompt = buildSystemPrompt(contextMode, semanticCtx);
  const insightsContext = contextMode === 'harvested' ? await buildInsightsContext(body.sessionId) : '';  const systemPrompt = insightsContext ? `${basePrompt}\n\n${insightsContext}` : basePrompt;

  // ── AM2.1: Operating Memory injection (feature-flagged) ─────────────────────
  // Mirrors the workbench injection block. Inspector class = 'inspector'.
  // isMemoryInjectionEnabled() is a pure sync env-var check — zero DB cost when off.
  let finalSystemPrompt = systemPrompt;
  let p1bRecallBlock = '';
  let injectedBullets: InjectedBullet[] = [];
  if (isMemoryInjectionEnabled('inspector')) {
    try {
      const org      = await getDefaultOrg();
      const taskCtx  = ((body.messages ?? []).find((m) => m.role === 'user' && m.content?.trim())?.content ?? '').trim().slice(0, 500);
      const topicMap = await getCurrentTopicMap(org.id);

      // Derive topicKey from the first user message content, matching workbench approach:
      // walk the topic map to find the first entry whose topicKey keyword appears in the
      // message text. Fall back to null (Phase 1a returns top global SCHEMA_MAPs).
      let topicKey: string | null = null;
      if (taskCtx) {
        const lc = taskCtx.toLowerCase();
        for (const [sig, entry] of topicMap.entries()) {
          if (entry.topicKey && sig && lc.includes(sig.toLowerCase())) {
            topicKey = entry.topicKey;
            break;
          }
        }
      }

      const { phase0, phase1a, phase1b } = await selectMemoryAll(org.id, 'inspector', taskCtx, topicKey);

      const p0Block  = formatForInjection(phase0,  MemoryPhase.INIT);
      const p1aBlock = formatForInjection(phase1a, MemoryPhase.SCHEMA_GLOBAL);
      p1bRecallBlock = formatForInjection(phase1b, MemoryPhase.TASK_SCOPED);

      if (p0Block)  finalSystemPrompt = finalSystemPrompt + '\n\n' + p0Block;
      if (p1aBlock) finalSystemPrompt = finalSystemPrompt + '\n\n' + p1aBlock;

      injectedBullets = [
        ...phase0.map((b) => ({ bulletId: b.id, phase: 'INIT' as const })),
        ...phase1a.map((b) => ({ bulletId: b.id, phase: 'SCHEMA_GLOBAL' as const })),
        ...phase1b.map((b) => ({ bulletId: b.id, phase: 'TASK_SCOPED' as const })),
      ];

      if (body.sessionId) {
        recordInjection(org.id, body.sessionId, injectedBullets).catch((e) => {
          console.warn('[M3/inspector] recordInjection failed (non-fatal):', e instanceof Error ? e.message : String(e));
        });
      }
    } catch (err) {
      console.warn('[AM2.1/inspector] Memory injection failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Phase 1b: inject recall turn as synthetic assistant message ───────────
  // Prepend a synthetic assistant message BEFORE the first user turn so the LLM
  // reads it as a prior recall signal. Only done when there is actual content and
  // the first message in userMessages is a user turn (Bedrock requires user first).
  if (p1bRecallBlock && userMessages[0]?.role === 'user') {
    userMessages.unshift({
      role: 'assistant',
      content: [{ text: p1bRecallBlock } as ContentBlock],
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const closed = { value: false };
      const encoder = new TextEncoder();

      request.signal.addEventListener('abort', () => {
        closed.value = true;
        try { controller.close(); } catch {}
      });

      const emit = (event: Record<string, unknown>) => {
        if (closed.value) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { closed.value = true; }
      };

      // Track query results accumulated this session for emit_chart context
      const sessionQueryResults: import('@/hooks/useInspectorChat').QueryResult[] = [];
      // Track last user message for emit_chart user intent
      let lastUserMessageText = '';
      if (userMessages.length > 0) {
        const lastUser = [...userMessages].reverse().find(m => m.role === 'user');
        lastUserMessageText = ((lastUser?.content?.[0] as { text?: string })?.text ?? '').trim();
      }

      // Wrap emit to accumulate query_result events for emit_chart context
      const emitWithTracking = (event: Record<string, unknown>) => {
        if (event.type === 'query_result') {
          sessionQueryResults.push({
            columns: event.columns as import('@/hooks/useInspectorChat').QueryResult['columns'],
            rows: event.rows as Record<string, unknown>[],
            sql: event.sql as string,
            rowCount: event.rowCount as number,
            truncated: event.truncated as boolean,
          });
        }
        emit(event);
      };

      // Bandit scoring counters
      let toolCallSuccessCount = 0;
      let toolCallErrorCount = 0;
      let hasControlBoundaryViolation = false;
      let hasRetryableErrors = false;
      const runStartTime = Date.now();

      // ── AM0.3 trace capture ──────────────────────────────────────────────────
      const sessionId = body.sessionId ?? '';
      const trace = isUUID(sessionId) ? openSession(sessionId, 'inspector') : null;

      // Turn-boundary correction: if the prior turn's last tool errored, the
      // current user message is recorded as a CORRECTION node.
      if (trace) {
        const pendingNodeId = pendingCorrectionNodeBySession.get(sessionId);
        if (pendingNodeId) {
          const lastUser = [...userMessages].reverse().find(m => m.role === 'user');
          const notes = ((lastUser?.content?.[0] as { text?: string })?.text ?? '').slice(0, 500);
          if (notes) trace.correction({ notes }, { correctsNodeId: pendingNodeId });
          pendingCorrectionNodeBySession.delete(sessionId);
        }
      }

      // Per-call trace state — keyed on callId from onToolCallEvent
      const actionNodeByCallId = new Map<string, string>();
      const toolNameByCallId = new Map<string, string>();
      const describeSchemaPathByCallId = new Map<string, string>();
      let lastToolResultNodeId: string | null = null;
      let lastToolInvocationWasError = false;

      try {
        emit({ type: 'stream_start', model: effectiveModelId, modelKey: body.model || DEFAULT_MODEL_KEY, supportsThinking: modelConfig.supportsThinking, maxLoops: 8, contextMode });

        // Resolve BoostModel for Foundry dispatch
        const boostModel = isFoundryModel
          ? BOOST_MODELS.find(m => m.modelId === modelConfig.foundryDeployment)
          : undefined;

        const loopParams = {
          modelId: isFoundryModel ? (modelConfig.foundryDeployment!) : modelId,
          systemPrompt: finalSystemPrompt,
          messages: userMessages,
          tools: toolConfig,
          executeTool: (toolName: string, toolInput: Record<string, unknown>, callId: string) => executeInspectorTool(toolName, toolInput, callId, emitWithTracking, {
            queryResults: sessionQueryResults,
            model: modelId || modelConfig.bedrockId,
            lastUserMessage: lastUserMessageText,
            sessionId: body.sessionId ?? '',
            connectionId: resolvedConnectionId,
          }),
          maxLoops: 8,
          supportsTools: modelConfig.supportsTools,
          supportsThinking: modelConfig.supportsThinking,
          abortSignal: closed,
          onLoopStart: (loop: number, maxLoops: number) => {
            emit({ type: 'loop_start', loop, maxLoops });
          },
          onTextChunk: (delta: string) => {
            emit({ type: 'text', delta });
          },
          onThinkingChunk: (delta: string) => {
            emit({ type: 'thinking', delta });
          },
          onToolCallEvent: (event: import('@/lib/inspector/agent-loop').ToolCallEvent) => {
            if (event.type === 'tool_call_suggested') {
              emit({ type: 'tool_call_suggested', callId: event.callId, toolId: event.toolName, toolName: event.toolName, reason: event.reason });
            } else if (event.type === 'tool_call_running') {
              emit({ type: 'tool_call_running', callId: event.callId, toolId: event.toolName, input: event.input });
              // AM0.3 — ACTION node (fire-and-forget)
              if (trace) {
                // Capture full tool input (SQL statement, schema path, etc.) truncated
                // at 2000 chars — truncatePayload handles the hard safety cap at 4096.
                const inputRaw = JSON.stringify(event.input);
                const actionNodeId = trace.action({
                  toolName:   event.toolName,
                  toolParams: JSON.parse(inputRaw.slice(0, 2000)) as Record<string, unknown>,
                });
                actionNodeByCallId.set(event.callId, actionNodeId);
                toolNameByCallId.set(event.callId, event.toolName);
                if (event.toolName === 'describe_schema' && typeof (event.input as Record<string, unknown>).path === 'string') {
                  describeSchemaPathByCallId.set(event.callId, (event.input as Record<string, unknown>).path as string);
                }
              }
            } else if (event.type === 'tool_call_result') {
              emit({ type: 'tool_call_result', callId: event.callId, output: event.output, durationMs: event.durationMs });
              // AM0.3 — OUTCOME node + optional SOURCE (fire-and-forget)
              if (trace) {
                const actionId = actionNodeByCallId.get(event.callId);
                const toolName = toolNameByCallId.get(event.callId) ?? 'unknown';
                if (actionId) {
                  // Full output gives Reflector access to schema descriptions and
                  // query results, not just a 200-char snippet.
                  const resultNodeId = trace.outcome(
                    {
                      toolName,
                      responseSummary: JSON.stringify(event.output).slice(0, 2000),
                      notes: event.durationMs != null ? `durationMs:${event.durationMs}` : undefined,
                    },
                    { fromNodeId: actionId },
                  );
                  lastToolResultNodeId = resultNodeId;
                  lastToolInvocationWasError = false;
                  const schemaPath = describeSchemaPathByCallId.get(event.callId);
                  if (toolName === 'describe_schema' && schemaPath) {
                    trace.source({ sourceRef: schemaPath });
                  }
                }
              }
            } else if (event.type === 'tool_call_error') {
              emit({ type: 'tool_call_error', callId: event.callId, error: event.error, retryable: event.retryable });
              // AM0.3 — DEAD_END node (fire-and-forget)
              if (trace) {
                const actionId = actionNodeByCallId.get(event.callId);
                const toolName = toolNameByCallId.get(event.callId) ?? 'unknown';
                if (actionId) {
                  // Include both the full error AND the triggering input so the
                  // Reflector can identify which SQL / path caused the failure.
                  // The raw input was already stored in the ACTION node payload
                  // for this callId; reference it by callId in notes for correlation.
                  const resultNodeId = trace.deadEnd(
                    {
                      toolName,
                      errorMessage: event.error.slice(0, 1000),
                      notes: `callId:${event.callId}`,
                    },
                    { fromNodeId: actionId },
                  );
                  lastToolResultNodeId = resultNodeId;
                  lastToolInvocationWasError = true;
                }
              }
            } else if (event.type === 'query_result') {
              emit({ type: 'query_result', columns: event.columns, rows: event.rows, sql: event.sql, rowCount: event.rowCount, truncated: event.truncated });
            }
          },
          onLoopUsage: (loop: number, inputTokens: number, outputTokens: number, totalInputTokens: number, totalOutputTokens: number) => {
            emit({ type: 'loop_usage', loop, inputTokens, outputTokens, totalInputTokens, totalOutputTokens });
          },
          onTextReplace: (text: string) => {
            emit({ type: 'text_replace', text });
          },
        };

        const result = isFoundryModel && boostModel
          ? await dispatchAgentLoop(boostModel, loopParams)
          : await runAgentLoop(loopParams);

        // Accumulate bandit counters from trajectory
        for (const entry of result.toolCalls) {
          if (entry.status === 'error') {
            toolCallErrorCount++;
            let errStr = '';
            try {
              const parsed = JSON.parse(entry.output ?? '');
              errStr = String(parsed?.error ?? '');
            } catch {}
            if (errStr === 'READ_ONLY_VIOLATION' || errStr === 'MULTI_STATEMENT') {
              hasControlBoundaryViolation = true;
            } else {
              hasRetryableErrors = true;
            }
          } else {
            toolCallSuccessCount++;
          }
        }

        if (result.outcome === 'completed') {
          const extracted = extractSuggestionsFromText(result.finalText ?? '');
          emit({ type: 'suggestions', items: extracted.length >= 2 ? extracted : ['Show table columns', 'Sample a few rows', 'Check row counts by date'] });

          const { qualityScore, success } = scoreRun({
            completed: true,
            toolCallSuccessCount,
            toolCallErrorCount,
            hasControlBoundaryViolation,
            hasRetryableErrors,
            loopsUsed: result.loops,
            maxLoops: 8,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
          });

          emit({ type: 'done', usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, model: effectiveModelId, loops: result.loops, qualityScore, contextMode, outcome: 'completed' as const, toolTrajectory: result.toolCalls });

          logAgentCost({ agentName: 'InspectorChat', agentVersion: '1.0.0', runId: body.sessionId, model: effectiveModelId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, toolCalls: result.loops - 1, status: success ? 'success' : 'failed' }).catch(() => {});
          reportToBandit({ source: 'inspector', model: effectiveModelId, success, qualityScore, durationMs: Date.now() - runStartTime, sheetType: 'inspector_chat', sessionId: body.sessionId }).catch(() => {});

          // Write CTSGV bandit observation (C + T immediate; S + G filled by async judge)
          if (body.sessionId) {
            writeBanditObservation({
              source: 'inspector',
              sourceRunId: body.sessionId,
              modelId: effectiveModelId,
              provider: inferProvider(effectiveModelId),
              sheetType: 'inspector_chat',
              answerFull: result.finalText ?? null,
              toolTrajectory: result.toolCalls,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              toolCallsTotal: toolCallSuccessCount + toolCallErrorCount,
              toolCallsError: toolCallErrorCount,
              toolCallsDiscovery: result.toolCalls.filter(tc => tc.kind === 'discovery').length,
              durationMs: Date.now() - runStartTime,
              outcome: 'completed',
              groundednessMode: 'consistency_check',
            }).then(obsId => {
              if (obsId) scoreSingleObservation(obsId).catch(() => {});
            }).catch(() => {});
          }

          if (body.sessionId) {
            const toolUseBlocks = result.toolCalls.map(tc => ({ toolUseId: `${tc.seq}`, name: tc.tool, input: '' }));
            evaluateTrajectoryReflection({
              sessionId: body.sessionId,
              trajectoryAnalysis: result.finalText ?? '',
              toolCalls: toolUseBlocks,
              datasourceCaveats: [],
            }).catch(() => {});
          }

          // M3: attribute injected bullets to this run outcome
          if (body.sessionId) {
            attributeRunOutcome(body.sessionId, { success }).catch(() => {});
          }
        } else if (result.outcome === 'truncated') {
          if (!closed.value) {
            emit({
              type: 'text',
              delta: '\n\n---\n**Tool-call limit reached.** I used all 8 available query slots for this turn. You can continue the conversation to explore further — previous results remain visible in the dashboard and I can reference them in follow-up turns.',
            });
            emit({ type: 'loop_limit_reached', loops: result.loops, maxLoops: 8 });
            emit({
              type: 'suggestions',
              items: ['Continue from where you left off', 'Summarize what we found so far', 'Start a new exploration'],
            });
          }

          const { qualityScore: qlLimitScore, success: qlLimitSuccess } = scoreRun({
            completed: false,
            toolCallSuccessCount,
            toolCallErrorCount,
            hasControlBoundaryViolation,
            hasRetryableErrors,
            loopsUsed: result.loops,
            maxLoops: 8,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
          });

          emit({ type: 'done', usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, model: effectiveModelId, loops: result.loops, limitReached: true, qualityScore: qlLimitScore, contextMode, outcome: 'truncated' as const, toolTrajectory: result.toolCalls });
          logAgentCost({ agentName: 'InspectorChat', agentVersion: '1.0.0', runId: body.sessionId, model: effectiveModelId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, toolCalls: result.loops - 1, status: qlLimitSuccess ? 'success' : 'failed' }).catch(() => {});
          reportToBandit({ source: 'inspector', model: effectiveModelId, success: qlLimitSuccess, qualityScore: qlLimitScore, durationMs: Date.now() - runStartTime, sheetType: 'inspector_chat', sessionId: body.sessionId }).catch(() => {});

          // Write CTSGV bandit observation for truncated run (capped at 0.4 by outcome gate)
          if (body.sessionId) {
            writeBanditObservation({
              source: 'inspector',
              sourceRunId: `${body.sessionId}_trunc`,
              modelId: effectiveModelId,
              provider: inferProvider(effectiveModelId),
              sheetType: 'inspector_chat',
              answerFull: result.finalText ?? null,
              toolTrajectory: result.toolCalls,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              toolCallsTotal: toolCallSuccessCount + toolCallErrorCount,
              toolCallsError: toolCallErrorCount,
              toolCallsDiscovery: result.toolCalls.filter(tc => tc.kind === 'discovery').length,
              durationMs: Date.now() - runStartTime,
              outcome: 'truncated',
              groundednessMode: 'consistency_check',
            }).then(obsId => {
              if (obsId) scoreSingleObservation(obsId).catch(() => {});
            }).catch(() => {});
          }

          // M3: attribute injected bullets to this run outcome (truncated = partial success)
          if (body.sessionId) {
            attributeRunOutcome(body.sessionId, { success: qlLimitSuccess }).catch(() => {});
          }
        } else {
          // errored
          emit({ type: 'error', message: result.errorDetail ?? 'Chat stream failed', recoverable: true });
          emit({ type: 'done', usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, model: effectiveModelId, loops: result.loops, qualityScore: 0, contextMode, outcome: 'errored' as const, toolTrajectory: result.toolCalls });

          // M3: attribute injected bullets to this run outcome (errored = failure)
          if (body.sessionId) {
            attributeRunOutcome(body.sessionId, { success: false }).catch(() => {});
          }
        }

        if (!closed.value) {
          try { controller.close(); } catch {}
        }

        // AM0.3 — persist pending correction anchor for the next turn
        if (lastToolInvocationWasError && lastToolResultNodeId && isUUID(sessionId)) {
          pendingCorrectionNodeBySession.set(sessionId, lastToolResultNodeId);
        }

        // Marcus first-turn reflection — fires only on the first question (one user message)
        // Fire-and-forget, never blocks the response.
        const inspectorTurnIndex = userMessages.filter(m => m.role === 'user').length;
        if (inspectorTurnIndex === 1 && body.sessionId) {
          const firstQuestion = ((userMessages.find(m => m.role === 'user')
            ?.content?.[0] as { text?: string })?.text ?? '').trim();
          if (firstQuestion) {
            evaluateInspectorFirstTurn({
              sessionId: body.sessionId,
              firstQuestion,
            }).catch(() => {});
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Chat stream failed';
        emit({ type: 'error', message: msg, recoverable: true });
        emit({ type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, model: effectiveModelId, loops: 0, qualityScore: 0, contextMode, outcome: 'errored' as const, toolTrajectory: [] });
        if (!closed.value) { closed.value = true; try { controller.close(); } catch {} }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function cannedResponse(request: NextRequest) {
  const events = [
    { type: 'text', delta: 'I can help you explore your Databricks warehouse. ' },
    { type: 'text', delta: 'Try asking: "What catalogs are available?" or "Show me tables in synergy_dwh".\n\n' },
    { type: 'suggestions', items: ['Show catalogs', 'List tables in synergy_dwh', 'Sample 10 rows from a table'] },
    { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const closed = { value: false };
      const encoder = new TextEncoder();
      request.signal.addEventListener('abort', () => { closed.value = true; try { controller.close(); } catch {} });

      for (const event of events) {
        if (closed.value) break;
        await sleep(120);
        if (closed.value) break;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { closed.value = true; }
      }
      if (!closed.value) { try { controller.close(); } catch {} }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
