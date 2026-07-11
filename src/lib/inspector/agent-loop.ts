import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import { classifyToolCall, type ToolKind } from '@/lib/boost/classify';

export type TrajectoryEntry = {
  seq: number;
  tool: string;
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
  onTextChunk?: (delta: string) => void;
  onThinkingChunk?: (delta: string) => void;
  onToolCallEvent?: (event: ToolCallEvent) => void;
  onLoopStart?: (loop: number, maxLoops: number) => void;
  onLoopUsage?: (loop: number, inputTokens: number, outputTokens: number, totalInput: number, totalOutput: number) => void;
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
    onTextChunk,
    onThinkingChunk,
    onToolCallEvent,
    onLoopStart,
    onLoopUsage,
    onTextReplace,
    abortSignal,
  } = params;

  const client = getBedrockClient();

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
        system: [{ text: systemPrompt }],
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

      const response = await client.send(command);
      let fullText = '';
      const toolUseBlocks: { toolUseId: string; name: string; input: string }[] = [];
      let activeToolIdx = -1;
      let inputTokens = 0;
      let outputTokens = 0;

      if (response.stream) {
        for await (const chunk of response.stream) {
          if (abortSignal?.value) break;

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
          }
        }
      }

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      onLoopUsage?.(loopCount, inputTokens, outputTokens, totalInputTokens, totalOutputTokens);

      if (toolUseBlocks.length === 0) {
        onTextReplace?.(stripInspectorMarkup(fullText).trim());
      }

      if (toolUseBlocks.length > 0 && !(abortSignal?.value)) {
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
