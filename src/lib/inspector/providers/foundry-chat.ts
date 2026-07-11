import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ToolConfiguration, Message } from '@aws-sdk/client-bedrock-runtime';
import type { BoostModel } from '../../boost/models';
import type { AgentLoopParams, AgentLoopResult, TrajectoryEntry } from '../agent-loop';
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
} as const;

function getFoundryClient(model: BoostModel): OpenAI {
  const resource = model.resource ?? 'resource2';
  const cfg = RESOURCE_CONFIG[resource];
  const apiKey = cfg.getApiKey();

  // Bedrock Mantle uses standard Authorization: Bearer header (no api-key header)
  const defaultHeaders = resource === 'bedrock-mantle'
    ? {}
    : { 'api-key': apiKey };

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

// ── Main Loop ───────────────────────────────────────────────────────────────────

export async function runFoundryAgentLoop(
  params: AgentLoopParams & { model: BoostModel },
): Promise<AgentLoopResult> {
  const {
    model, systemPrompt, messages: initialMessages, tools, executeTool, maxLoops, abortSignal,
    onLoopStart, onTextChunk, onToolCallEvent, onLoopUsage,
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

        // Emit text for non-streaming path
        if (assistantContent) onTextChunk?.(assistantContent);

        if (choice?.message?.tool_calls) {
          toolCalls = choice.message.tool_calls.map(tc => {
            const fn = (tc as { id: string; function: { name: string; arguments: string } }).function;
            return { id: tc.id, function: { name: fn.name, arguments: fn.arguments } };
          });
        }
      }

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      onLoopUsage?.(loopCount, inputTokens, outputTokens, totalInputTokens, totalOutputTokens);

      // ── No tool calls → model returned final answer ────────────────────────
      if (toolCalls.length === 0) {
        finalText = assistantContent.trim() || null;
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
            onToolCallEvent?.({ type: 'tool_call_result', callId: tc.id, output: parsedOutput, durationMs });
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
