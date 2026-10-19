import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { ToolConfiguration, Message } from '@aws-sdk/client-bedrock-runtime';
import type { BoostModel } from '../../boost/models';
import { measureContext, type AgentLoopParams, type AgentLoopResult, type LoopMetrics, type TrajectoryEntry } from '../agent-loop';
import { classifyToolCall } from '@/lib/boost/classify';

// ── Resource Configuration ──────────────────────────────────────────────────────

const RESOURCE_CONFIG = {
  resource1: {
    getBaseURL: (deploymentName: string) =>
      `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${deploymentName}`,
    getApiKey: () => process.env.AZURE_OPENAI_API_KEY!,
    getDefaultQuery: () => ({
      'api-version': process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview',
    }),
  },
  resource2: {
    getBaseURL: (_: string) =>
      `${process.env.FOUNDRY_ENDPOINT}/openai/v1`,
    getApiKey: () => process.env.FOUNDRY_API_KEY!,
    getDefaultQuery: (): Record<string, string> => ({}),
  },
  'bedrock-mantle': {
    getBaseURL: (_: string) =>
      `https://bedrock-mantle.${process.env.BEDROCK_MANTLE_REGION ?? 'us-east-2'}.api.aws/openai/v1`,
    getApiKey: () => process.env.BEDROCK_MANTLE_API_KEY!,
    getDefaultQuery: (): Record<string, string> => ({}),
  },
  xai: {
    getBaseURL: (_: string) =>
      process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    getApiKey: () => process.env.XAI_API_KEY!,
    getDefaultQuery: (): Record<string, string> => ({}),
  },
} as const;

function getFoundryClient(model: BoostModel): OpenAI {
  const resource = model.resource ?? 'resource2';
  const cfg = RESOURCE_CONFIG[resource as keyof typeof RESOURCE_CONFIG];
  const apiKey = cfg.getApiKey();

  // xAI and Bedrock Mantle use standard OpenAI Bearer auth (no special api-key header)
  const usesStandardAuth = resource === 'bedrock-mantle' || resource === 'xai';
  const defaultHeaders = usesStandardAuth ? {} : { 'api-key': apiKey };

  return new OpenAI({
    apiKey,
    baseURL: cfg.getBaseURL(model.modelId),
    defaultQuery: cfg.getDefaultQuery(),
    defaultHeaders,
  });
}

// ── Tool Format Translation ─────────────────────────────────────────────────────

function translateTools(bedrockToolConfig: ToolConfiguration): ChatCompletionTool[] {
  return (bedrockToolConfig.tools ?? []).map(t => ({
    type: 'function' as const,
    function: {
      name: t.toolSpec!.name!,
      description: t.toolSpec!.description!,
      parameters: t.toolSpec!.inputSchema!.json as Record<string, unknown>,
    },
  }));
}

// ── Token Config ────────────────────────────────────────────────────────────────

function buildTokenConfig(model: BoostModel, limit: number): Record<string, number> {
  return { [model.tokenParam ?? 'max_tokens']: limit };
}

// ── Bedrock → OpenAI Message Conversion ─────────────────────────────────────────

function convertBedrockMessages(msgs: Message[]): ChatCompletionMessageParam[] {
  return msgs.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content?.map(b => {
      const block = b as unknown as Record<string, unknown>;
      if ('text' in block) return block.text as string;
      return '';
    }).join('') ?? '',
  }));
}

// ── SQL Extraction ──────────────────────────────────────────────────────────────
// execute_tool schema: { tool_name: string, args: { statement: string } }
// describe_schema: { action, connection, path?, query?, ... } — no SQL

function extractSql(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName !== 'execute_tool') return null;
  const args = input.args as { statement?: string } | undefined;
  return args?.statement?.slice(0, 120) ?? null;
}

// ── Timeout ──────────────────────────────────────────────────────────────────────
// GPT-5 family on Azure can hang indefinitely on tool-call requests when the
// deployment is degraded. Cap each model call at FOUNDRY_TOOL_TIMEOUT_MS.
const FOUNDRY_TOOL_TIMEOUT_MS = parseInt(process.env.FOUNDRY_TOOL_TIMEOUT_MS ?? '45000', 10);
// grok-4.7 reasons before the first token. 45s is the Azure hang cap and will
// abort a healthy Grok turn. Refresh this on every stream event.
const XAI_REQUEST_TIMEOUT_MS = parseInt(process.env.XAI_REQUEST_TIMEOUT_MS ?? '180000', 10);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[${label}] Azure Foundry request timed out after ${ms}ms — tool calling may be unavailable on this deployment`)),
      ms,
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

// ── xAI Responses API (grok-4.7) ────────────────────────────────────────────────
// Chat Completions has no field for encrypted reasoning. Each tool round then
// starts from scratch, which is the "ranking query never ran" repeat. Responses
// returns that reasoning on every output item; it has to be sent back unchanged.

type XaiEffort = 'low' | 'medium' | 'high' | 'xhigh';

function xaiReasoningEffort(): XaiEffort {
  const raw = (process.env.XAI_REASONING_EFFORT ?? 'low').trim().toLowerCase();
  if (raw === 'medium' || raw === 'high' || raw === 'xhigh') return raw;
  return 'low';
}

function translateResponsesTools(bedrockToolConfig: ToolConfiguration): OpenAI.Responses.FunctionTool[] {
  return (bedrockToolConfig.tools ?? []).map(t => ({
    type: 'function' as const,
    name: t.toolSpec!.name!,
    description: t.toolSpec!.description!,
    parameters: (t.toolSpec!.inputSchema!.json ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    strict: false,
  }));
}

function toResponseInput(systemPrompt: string, msgs: Message[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  if (systemPrompt.trim()) {
    items.push({ role: 'system', content: systemPrompt });
  }
  for (const m of convertBedrockMessages(msgs)) {
    if (m.role === 'user' || m.role === 'assistant') {
      items.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' });
    }
  }
  return items;
}

/** Rows already travel on query_result. The tool card only needs a small status payload. */
function uiToolOutput(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const rowObj = parsed as { rows?: unknown; row_count?: unknown; columns?: unknown; truncated?: unknown; error?: unknown };
  if (!Array.isArray(rowObj.rows)) return parsed;
  return {
    ok: rowObj.error == null,
    row_count: rowObj.row_count ?? rowObj.rows.length,
    columns: rowObj.columns,
    truncated: rowObj.truncated ?? false,
  };
}

function responseOutputText(response: OpenAI.Responses.Response): string {
  return response.output
    .filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === 'message')
    .flatMap(item => item.content)
    .map(part => (part.type === 'output_text' ? part.text : ''))
    .join('');
}

async function runXaiResponsesLoop(
  params: AgentLoopParams & { model: BoostModel },
): Promise<AgentLoopResult> {
  const {
    model, systemPrompt, messages: initialMessages, tools, executeTool, maxLoops, abortSignal,
    onLoopStart, onTextChunk, onToolCallEvent, onLoopUsage, onLoopMetrics, onTextReplace,
  } = params;

  const client = getFoundryClient(model);
  const openAITools = translateResponsesTools(tools);
  const promptCacheKey = randomUUID();

  let loopCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const trajectory: TrajectoryEntry[] = [];
  let trajSeq = 0;
  let finalText: string | null = null;
  let inputItems = toResponseInput(systemPrompt, initialMessages);

  try {
    while (loopCount < maxLoops && !(abortSignal?.value)) {
      loopCount++;
      onLoopStart?.(loopCount, maxLoops);

      let assistantContent = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      const loopStartedAt = Date.now();
      const ctx = measureContext(systemPrompt, inputItems);
      let firstTokenAt: number | null = null;
      let completed: OpenAI.Responses.Response | null = null;
      // output_index -> the exact id already shown on the tool card
      const uiCallIdByOutput = new Map<number, string>();

      const ac = new AbortController();
      const stallTimer = setTimeout(() => ac.abort(), XAI_REQUEST_TIMEOUT_MS);

      const stream = await client.responses.create({
        model: model.modelId,
        input: inputItems,
        tools: openAITools,
        // xAI: stay near 0.7 / 0.95. Other sampling values degrade Grok.
        // Do not copy this onto GPT-5 / Luna — those reject any non-default temperature.
        temperature: 0.7,
        top_p: 0.95,
        reasoning: { effort: xaiReasoningEffort() },
        max_output_tokens: 4096,
        include: ['reasoning.encrypted_content'],
        store: false,
        stream: true,
        prompt_cache_key: promptCacheKey,
      }, { signal: ac.signal });

      try {
        for await (const event of stream) {
          stallTimer.refresh?.();
          if (abortSignal?.value) break;

          if (event.type === 'response.output_text.delta') {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            assistantContent += event.delta;
            onTextChunk?.(event.delta);
          }

          if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            const uiCallId = event.item.call_id || event.item.id || `xai-${loopCount}-${event.output_index}`;
            uiCallIdByOutput.set(event.output_index, uiCallId);
            onToolCallEvent?.({
              type: 'tool_call_suggested',
              callId: uiCallId,
              toolName: event.item.name,
              reason: `Loop ${loopCount}/${maxLoops}`,
            });
          }

          if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            completed = event.response;
          }
        }
      } finally {
        clearTimeout(stallTimer);
      }

      if (!completed) {
        throw new Error(`[${model.modelId}] xAI response ended before completion`);
      }

      inputTokens = completed.usage?.input_tokens ?? 0;
      outputTokens = completed.usage?.output_tokens ?? 0;
      cacheReadTokens = completed.usage?.input_tokens_details?.cached_tokens ?? 0;
      if (!assistantContent) assistantContent = responseOutputText(completed);

      const calls = completed.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      const llmMs = Date.now() - loopStartedAt;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      onLoopUsage?.(loopCount, inputTokens, outputTokens, totalInputTokens, totalOutputTokens);
      const reportLoop = (toolMs: number, stopReason: LoopMetrics['stopReason']) =>
        onLoopMetrics?.({
          loop: loopCount,
          startedAt: loopStartedAt,
          llmMs,
          firstTokenMs: firstTokenAt !== null ? firstTokenAt - loopStartedAt : null,
          toolMs,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens: 0,
          ...ctx,
          toolCalls: calls.length,
          stopReason,
        });

      // Pass reasoning, messages, and function calls back exactly as received.
      inputItems = inputItems.concat(completed.output as ResponseInputItem[]);

      if (calls.length === 0) {
        reportLoop(0, abortSignal?.value ? 'aborted' : 'end_turn');
        finalText = assistantContent.trim() || null;
        if (finalText) onTextReplace?.(finalText);
        return {
          finalText,
          toolCalls: trajectory,
          outcome: 'completed',
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          loops: loopCount,
        };
      }

      const toolBatchStart = Date.now();
      const toolResults = await Promise.all(
        calls.map(async (call) => {
          const outputIndex = completed.output.indexOf(call);
          const callId = uiCallIdByOutput.get(outputIndex) || call.call_id || call.id || `xai-${loopCount}-${outputIndex}`;
          let toolInput: Record<string, unknown> = {};
          try { toolInput = JSON.parse(call.arguments || '{}'); } catch { /* malformed args */ }

          onToolCallEvent?.({ type: 'tool_call_running', callId, toolName: call.name, input: toolInput });

          const startTime = Date.now();
          let toolResult: string;
          let toolStatus: 'success' | 'error';
          try {
            toolResult = await executeTool(call.name, toolInput, callId);
            toolStatus = 'success';
          } catch (err: unknown) {
            toolResult = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            toolStatus = 'error';
          }
          const durationMs = Date.now() - startTime;

          if (toolStatus === 'success') {
            let parsedOutput: unknown = toolResult;
            try { parsedOutput = JSON.parse(toolResult); } catch { /* plain text */ }
            onToolCallEvent?.({ type: 'tool_call_result', callId, output: uiToolOutput(parsedOutput), durationMs });
          } else {
            const errStr = (() => { try { return String(JSON.parse(toolResult)?.error ?? toolResult); } catch { return toolResult; } })();
            onToolCallEvent?.({ type: 'tool_call_error', callId, error: errStr, retryable: true });
          }

          const sqlExcerpt = extractSql(call.name, toolInput);
          trajectory.push({
            seq: ++trajSeq,
            tool: call.name,
            callId,
            sqlExcerpt,
            input: toolInput,
            output: toolResult ? toolResult.slice(0, 2000) : null,
            status: toolStatus,
            durationMs,
            kind: classifyToolCall({ tool: call.name, sql: sqlExcerpt ?? undefined, status: toolStatus }),
          });

          const outputItem: ResponseInputItem = {
            type: 'function_call_output',
            call_id: call.call_id,
            output: toolResult,
          };
          return outputItem;
        }),
      );
      reportLoop(Date.now() - toolBatchStart, loopCount >= maxLoops ? 'max_loops' : 'tool_use');
      inputItems = inputItems.concat(toolResults);
    }

    return {
      finalText,
      toolCalls: trajectory,
      outcome: 'truncated',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      loops: loopCount,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : 'xAI agent loop failed';
    const isTimeout = rawMsg.includes('timed out') || rawMsg.includes('aborted') || rawMsg.includes('ended before completion');
    const errorDetail = isTimeout
      ? `${model.label} request timed out after ${XAI_REQUEST_TIMEOUT_MS / 1000}s. Grok 4.7 can spend that time reasoning; retry, or set XAI_REASONING_EFFORT=low.`
      : rawMsg;
    return {
      finalText,
      toolCalls: trajectory,
      outcome: 'errored',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      loops: loopCount,
      errorDetail,
    };
  }
}

// ── Main Loop ───────────────────────────────────────────────────────────────────

export async function runFoundryAgentLoop(
  params: AgentLoopParams & { model: BoostModel },
): Promise<AgentLoopResult> {
  if (params.model.resource === 'xai') {
    return runXaiResponsesLoop(params);
  }

  const {
    model, systemPrompt, messages: initialMessages, tools, executeTool, maxLoops, abortSignal,
    onLoopStart, onTextChunk, onToolCallEvent, onLoopUsage, onLoopMetrics, onTextReplace,
  } = params;

  const client = getFoundryClient(model);
  const openAITools = translateTools(tools);
  const shouldStream = model.modelId !== 'o3-mini';

  let loopCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const trajectory: TrajectoryEntry[] = [];
  let trajSeq = 0;
  let finalText: string | null = null;

  let messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...convertBedrockMessages(initialMessages),
  ];

  try {
    while (loopCount < maxLoops && !(abortSignal?.value)) {
      loopCount++;
      onLoopStart?.(loopCount, maxLoops);

      // ── Call model (streaming or non-streaming) ────────────────────────────
      let assistantContent = '';
      let toolCalls: { id: string; function: { name: string; arguments: string } }[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      const loopStartedAt = Date.now();
      const ctx = measureContext('', messages);
      let firstTokenAt: number | null = null;

      if (shouldStream) {
        // Streaming path: accumulate deltas, assemble partial tool_calls by index
        // Use AbortController to enforce a hard timeout on the full stream lifecycle
        // (Azure GPT-5.4 can hang indefinitely on tool-call requests when degraded)
        const ac = new AbortController();
        const stallTimer = setTimeout(() => ac.abort(), FOUNDRY_TOOL_TIMEOUT_MS);

        const stream = await client.chat.completions.create({
          model: model.modelId,
          messages,
          tools: openAITools,
          ...buildTokenConfig(model, 4096),
          stream: true,
          stream_options: { include_usage: true },
        }, { signal: ac.signal });

        // Accumulators for partial tool_call deltas — indexed by tool_call position
        const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

        try {
          for await (const chunk of stream) {
            // Reset stall timer on each chunk
            stallTimer.refresh?.();
            // Text content delta
            const delta = chunk.choices?.[0]?.delta;
            if (firstTokenAt === null && (delta?.content || delta?.tool_calls)) firstTokenAt = Date.now();
            if (delta?.content) {
              assistantContent += delta.content;
              onTextChunk?.(delta.content);
            }

            // Tool call deltas — each arrives with an index indicating which
            // tool_call it belongs to. The first chunk for an index carries the
            // id + function.name; subsequent chunks append to function.arguments.
            if (delta?.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index;
                if (!toolCallAccumulators.has(idx)) {
                  toolCallAccumulators.set(idx, {
                    id: tcDelta.id ?? '',
                    name: tcDelta.function?.name ?? '',
                    arguments: '',
                  });
                }
                const acc = toolCallAccumulators.get(idx)!;
                if (tcDelta.id) acc.id = tcDelta.id;
                if (tcDelta.function?.name) acc.name = tcDelta.function.name;
                if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
              }
            }

            // Usage (sent in the final chunk when stream_options.include_usage is set)
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
              cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
            }
          }
        } finally {
          clearTimeout(stallTimer);
        }

        // Convert accumulated partials into complete tool_call objects
        toolCalls = Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([, acc]) => ({
            id: acc.id,
            function: { name: acc.name, arguments: acc.arguments },
          }));
      } else {
        // Non-streaming path (o3-mini): await full response
        const responsePromise = client.chat.completions.create({
          model: model.modelId,
          messages,
          tools: openAITools,
          ...buildTokenConfig(model, 4096),
          stream: false,
        });

        const response = await withTimeout(responsePromise, FOUNDRY_TOOL_TIMEOUT_MS, model.modelId) as OpenAI.Chat.Completions.ChatCompletion;

        const choice = response.choices[0];
        assistantContent = choice?.message?.content ?? '';
        inputTokens = response.usage?.prompt_tokens ?? 0;
        outputTokens = response.usage?.completion_tokens ?? 0;
        cacheReadTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        firstTokenAt = Date.now();

        // Emit text for non-streaming path
        if (assistantContent) onTextChunk?.(assistantContent);

        if (choice?.message?.tool_calls) {
          toolCalls = choice.message.tool_calls.map(tc => {
            const fn = (tc as { id: string; function: { name: string; arguments: string } }).function;
            return { id: tc.id, function: { name: fn.name, arguments: fn.arguments } };
          });
        }
      }

      const llmMs = Date.now() - loopStartedAt;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      onLoopUsage?.(loopCount, inputTokens, outputTokens, totalInputTokens, totalOutputTokens);
      const reportLoop = (toolMs: number, stopReason: LoopMetrics['stopReason']) =>
        onLoopMetrics?.({
          loop: loopCount,
          startedAt: loopStartedAt,
          llmMs,
          firstTokenMs: firstTokenAt !== null ? firstTokenAt - loopStartedAt : null,
          toolMs,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          // OpenAI-compatible APIs cache automatically and don't bill/report writes.
          cacheWriteTokens: 0,
          ...ctx,
          toolCalls: toolCalls.length,
          stopReason,
        });

      // ── No tool calls → model returned final answer ────────────────────────
      if (toolCalls.length === 0) {
        reportLoop(0, abortSignal?.value ? 'aborted' : 'end_turn');
        finalText = assistantContent.trim() || null;
        // Replace accumulated interim narration (prior tool loops) with the final answer only.
        if (finalText) onTextReplace?.(finalText);
        return {
          finalText,
          toolCalls: trajectory,
          outcome: 'completed',
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          loops: loopCount,
        };
      }

      // ── Execute all tool calls in parallel ─────────────────────────────────
      // Build the assistant message with tool_calls for the conversation history
      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
      messages.push(assistantMsg);

      const toolBatchStart = Date.now();
      const toolResults = await Promise.all(
        toolCalls.map(async (tc) => {
          let toolInput: Record<string, unknown> = {};
          try { toolInput = JSON.parse(tc.function.arguments); } catch {}

          // Emit tool call events so the frontend displays tool cards
          onToolCallEvent?.({ type: 'tool_call_suggested', callId: tc.id, toolName: tc.function.name, reason: '' });
          onToolCallEvent?.({ type: 'tool_call_running', callId: tc.id, toolName: tc.function.name, input: toolInput });

          const startTime = Date.now();
          let toolResult: string;
          let toolStatus: 'success' | 'error';

          try {
            toolResult = await executeTool(tc.function.name, toolInput, tc.id);
            toolStatus = 'success';
          } catch (err: unknown) {
            toolResult = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            toolStatus = 'error';
          }

          const durationMs = Date.now() - startTime;

          // Emit tool result/error event
          if (toolStatus === 'success') {
            let parsedOutput: unknown = toolResult;
            try { parsedOutput = JSON.parse(toolResult); } catch {}
            onToolCallEvent?.({ type: 'tool_call_result', callId: tc.id, output: uiToolOutput(parsedOutput), durationMs });
          } else {
            const errStr = (() => { try { return String(JSON.parse(toolResult)?.error ?? toolResult); } catch { return toolResult; } })();
            onToolCallEvent?.({ type: 'tool_call_error', callId: tc.id, error: errStr, retryable: true });
          }

          const sqlExcerpt = extractSql(tc.function.name, toolInput);
          const kind = classifyToolCall({
            tool: tc.function.name,
            sql: sqlExcerpt ?? undefined,
            status: toolStatus,
          });

          trajectory.push({
            seq: ++trajSeq,
            tool: tc.function.name,
            callId: tc.id,
            sqlExcerpt,
            input: toolInput,
            output: toolResult ? toolResult.slice(0, 2000) : null,
            status: toolStatus,
            durationMs,
            kind,
          });

          return { toolCallId: tc.id, content: toolResult };
        }),
      );
      reportLoop(Date.now() - toolBatchStart, loopCount >= maxLoops ? 'max_loops' : 'tool_use');

      // Append tool results as role:'tool' messages
      for (const r of toolResults) {
        messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      }
    }

    // Loop exhausted without clean break
    return {
      finalText,
      toolCalls: trajectory,
      outcome: 'truncated',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      loops: loopCount,
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : 'Foundry agent loop failed';
    const isTimeout = rawMsg.includes('timed out') || rawMsg.includes('aborted');
    const errorDetail = isTimeout
      ? `${model.label} tool-calling is currently unavailable (request timed out after ${FOUNDRY_TOOL_TIMEOUT_MS / 1000}s). This is an Azure deployment issue. Please switch to a different model (e.g. Claude Sonnet, Grok 4.3) and retry.`
      : rawMsg;
    return {
      finalText,
      toolCalls: trajectory,
      outcome: 'errored',
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      loops: loopCount,
      errorDetail,
    };
  }
}
