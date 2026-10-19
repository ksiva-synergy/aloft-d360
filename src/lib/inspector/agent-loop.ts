import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import { classifyToolCall, type ToolKind } from '@/lib/boost/classify';

export type TrajectoryEntry = {
  seq: number;
  tool: string;
  /** UI card id. Present so a missed tool_call_result can still settle the card. */
  callId?: string;
  sqlExcerpt: string | null;
  input: Record<string, unknown>;
  output: string | null;
  status: 'success' | 'error';
  durationMs: number;
  kind: ToolKind;
};

export type AgentLoopResult = {
  finalText: string | null;
  toolCalls: TrajectoryEntry[];
  outcome: 'completed' | 'truncated' | 'errored';
  usage: { inputTokens: number; outputTokens: number };
  loops: number;
  errorDetail?: string;
};

/** Per-LLM-call measurements, persisted to agent_loop_log by the caller. */
export type LoopMetrics = {
  loop: number;
  startedAt: number;
  /** Request sent → stream finished. */
  llmMs: number;
  /** Request sent → first streamed token (text, reasoning or tool call). */
  firstTokenMs: number | null;
  /** Wall time of the tool batch this loop triggered (parallel calls overlap). */
  toolMs: number;
  /** Total input tokens sent, INCLUDING cached ones (normalized across providers). */
  inputTokens: number;
  outputTokens: number;
  /** Subset of inputTokens served from the prompt cache. */
  cacheReadTokens: number;
  /** Subset of inputTokens written to the prompt cache (Bedrock/Anthropic only). */
  cacheWriteTokens: number;
  /** Size of the conversation sent on this call — shows context growth per loop. */
  contextMessages: number;
  contextChars: number;
  toolCalls: number;
  stopReason: 'tool_use' | 'end_turn' | 'max_loops' | 'aborted';
};

export function measureContext(systemPrompt: string, messages: unknown[]): { contextMessages: number; contextChars: number } {
  let chars = systemPrompt.length;
  try {
    chars += JSON.stringify(messages).length;
  } catch {
    /* non-serializable content — leave at system prompt size */
  }
  return { contextMessages: messages.length, contextChars: chars };
}

export type ToolCallEvent =
  | { type: 'tool_call_suggested'; callId: string; toolName: string; reason: string }
  | { type: 'tool_call_running'; callId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs: number }
  | { type: 'tool_call_error'; callId: string; error: string; retryable: boolean }
  | { type: 'query_result'; columns: unknown; rows: unknown; sql: string; rowCount: number; truncated: boolean };

export type AgentLoopParams = {
  modelId: string;
  systemPrompt: string;
  messages: Message[];
  tools: ToolConfiguration;
  executeTool: (toolName: string, toolInput: Record<string, unknown>, callId: string) => Promise<string>;
  maxLoops: number;
  supportsTools: boolean;
  supportsThinking: boolean;
  /**
   * Opt-in Bedrock prompt caching: append a cachePoint after the system prompt so
   * a STABLE system prefix (identical text across calls within the ~5-min TTL) is
   * cached, cutting TTFT + input cost on repeats. Only worth enabling when the
   * system prompt is model-stable (e.g. a per-model catalog) — a prompt that
   * embeds per-request text would just pay cache-writes with no hits. Below the
   * model's min cacheable size the cachePoint is silently ignored, never an error.
   */
  cacheSystemPrompt?: boolean;
  onTextChunk?: (delta: string) => void;
  onThinkingChunk?: (delta: string) => void;
  onToolCallEvent?: (event: ToolCallEvent) => void;
  onLoopStart?: (loop: number, maxLoops: number) => void;
  onLoopUsage?: (loop: number, inputTokens: number, outputTokens: number, totalInput: number, totalOutput: number) => void;
  /** Fired once per loop after its tools (if any) finish. */
  onLoopMetrics?: (metrics: LoopMetrics) => void;
  onTextReplace?: (text: string) => void;
  abortSignal?: { value: boolean };
};

function stripInspectorMarkup(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?thinking>/gi, '')
    .replace(/<query_result>[\s\S]*?<\/query_result>/gi, '');
}

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const {
    modelId,
    systemPrompt,
    messages: initialMessages,
    tools,
    executeTool,
    maxLoops,
    supportsTools,
    supportsThinking,
    cacheSystemPrompt,
    onTextChunk,
    onThinkingChunk,
    onToolCallEvent,
    onLoopStart,
    onLoopUsage,
    onLoopMetrics,
    onTextReplace,
    abortSignal,
  } = params;

  const client = getBedrockClient();

  // Stable system prefix + cachePoint when opted in; plain text otherwise.
  const system: SystemContentBlock[] = cacheSystemPrompt
    ? [{ text: systemPrompt }, { cachePoint: { type: 'default' } } as SystemContentBlock]
    : [{ text: systemPrompt }];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let loopCount = 0;
  let finalText: string | null = null;
  const trajectory: TrajectoryEntry[] = [];
  let trajSeq = 0;

  let messages = [...initialMessages];

  try {
    while (loopCount < maxLoops && !(abortSignal?.value)) {
      loopCount++;
      onLoopStart?.(loopCount, maxLoops);

      const isLastLoop = loopCount === maxLoops;
      const hasToolBlocks = messages.some(m =>
        m.content?.some(b => 'toolUse' in (b as unknown as Record<string, unknown>) || 'toolResult' in (b as unknown as Record<string, unknown>))
      );
      const mustIncludeToolConfig = supportsTools && (!isLastLoop || hasToolBlocks);

      const command = new ConverseStreamCommand({
        modelId,
        messages,
        system,
        ...(mustIncludeToolConfig ? { toolConfig: tools } : {}),
        inferenceConfig: {
          maxTokens: 4096,
          temperature: supportsThinking ? 1 : 0.3,
        },
        ...(supportsThinking && modelId.includes('anthropic') ? {
          additionalModelRequestFields: {
            thinking: { type: 'enabled', budget_tokens: 1024 },
          },
        } : {}),
      });

      const loopStartedAt = Date.now();
      const ctx = measureContext(systemPrompt, messages);
      let firstTokenAt: number | null = null;
      const response = await client.send(command);
      let fullText = '';
      const toolUseBlocks: { toolUseId: string; name: string; input: string }[] = [];
      let activeToolIdx = -1;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;

      if (response.stream) {
        for await (const chunk of response.stream) {
          if (abortSignal?.value) break;
          if (firstTokenAt === null && (chunk.contentBlockDelta || chunk.contentBlockStart)) firstTokenAt = Date.now();

          if (chunk.contentBlockDelta?.delta?.text) {
            const delta = chunk.contentBlockDelta.delta.text;
            fullText += delta;
            const cleanDelta = stripInspectorMarkup(delta);
            if (cleanDelta) onTextChunk?.(cleanDelta);
          }

          const reasoning = (chunk.contentBlockDelta?.delta as unknown as Record<string, unknown>)?.reasoningContent as { text?: string } | undefined;
          if (reasoning?.text) {
            onThinkingChunk?.(reasoning.text);
          }

          if (chunk.contentBlockStart?.start?.toolUse) {
            const tu = chunk.contentBlockStart.start.toolUse;
            toolUseBlocks.push({ toolUseId: tu.toolUseId!, name: tu.name!, input: '' });
            activeToolIdx = toolUseBlocks.length - 1;
            onToolCallEvent?.({ type: 'tool_call_suggested', callId: tu.toolUseId!, toolName: tu.name!, reason: `Loop ${loopCount}/${maxLoops}` });
          }

          if (chunk.contentBlockDelta?.delta?.toolUse && activeToolIdx >= 0) {
            toolUseBlocks[activeToolIdx].input += chunk.contentBlockDelta.delta.toolUse.input || '';
          }

          if (chunk.metadata?.usage) {
            inputTokens = chunk.metadata.usage.inputTokens || 0;
            outputTokens = chunk.metadata.usage.outputTokens || 0;
            cacheReadTokens = chunk.metadata.usage.cacheReadInputTokens || 0;
            cacheWriteTokens = chunk.metadata.usage.cacheWriteInputTokens || 0;
          }
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
          // Bedrock's inputTokens excludes cache reads/writes — report the full input size.
          inputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          ...ctx,
          toolCalls: toolUseBlocks.length,
          stopReason,
        });

      if (toolUseBlocks.length === 0) {
        onTextReplace?.(stripInspectorMarkup(fullText).trim());
      }

      if (toolUseBlocks.length > 0 && !(abortSignal?.value)) {
        const toolBatchStart = Date.now();
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            let toolInput: Record<string, unknown> = {};
            try { toolInput = JSON.parse(block.input); } catch {}

            onToolCallEvent?.({ type: 'tool_call_running', callId: block.toolUseId, toolName: block.name, input: toolInput });
            const toolStartTime = Date.now();
            const toolResult = await executeTool(block.name, toolInput, block.toolUseId);
            const toolDurationMs = Date.now() - toolStartTime;

            let parsedResult: unknown = toolResult;
            try { parsedResult = JSON.parse(toolResult); } catch {}

            const resultObj = parsedResult as Record<string, unknown> | null;
            const isError = resultObj && typeof resultObj === 'object' && 'error' in resultObj;

            const toolStatus: 'success' | 'error' = isError ? 'error' : 'success';
            const sqlInput = (toolInput as { args?: { statement?: string } })?.args?.statement ?? null;
            const kind = classifyToolCall({ tool: block.name, sql: sqlInput ?? undefined, status: toolStatus });

            trajectory.push({
              seq: ++trajSeq,
              tool: block.name,
              sqlExcerpt: sqlInput ? sqlInput.slice(0, 120) : null,
              input: toolInput,
              output: toolResult ? toolResult.slice(0, 2000) : null,
              status: toolStatus,
              durationMs: toolDurationMs,
              kind,
            });

            if (isError) {
              const errStr = String(resultObj!.error ?? '');
              onToolCallEvent?.({ type: 'tool_call_error', callId: block.toolUseId, error: errStr, retryable: !['READ_ONLY_VIOLATION', 'MULTI_STATEMENT'].includes(errStr) });
            } else {
              onToolCallEvent?.({ type: 'tool_call_result', callId: block.toolUseId, output: parsedResult, durationMs: toolDurationMs });
            }

            return { block, toolInput, toolResult };
          }),
        );
        reportLoop(Date.now() - toolBatchStart, loopCount >= maxLoops ? 'max_loops' : 'tool_use');

        const assistantContent: ContentBlock[] = [];
        if (fullText.trim()) assistantContent.push({ text: fullText } as ContentBlock);
        for (const { block, toolInput } of toolResults) {
          assistantContent.push({ toolUse: { toolUseId: block.toolUseId, name: block.name, input: toolInput } } as unknown as ContentBlock);
        }
        const userContent: ContentBlock[] = toolResults.map(({ block, toolResult }) => (
          { toolResult: { toolUseId: block.toolUseId, content: [{ text: toolResult }] } } as unknown as ContentBlock
        ));

        messages = [...messages, { role: 'assistant', content: assistantContent }, { role: 'user', content: userContent }];
        continue;
      }

      // Clean break — model returned text with no tool calls
      reportLoop(0, abortSignal?.value ? 'aborted' : 'end_turn');
      finalText = stripInspectorMarkup(fullText).trim();
      return {
        finalText,
        toolCalls: trajectory,
        outcome: 'completed',
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        loops: loopCount,
      };
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
    const errorDetail = err instanceof Error ? err.message : 'Agent loop failed';
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
