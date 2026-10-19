import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';
import type { TraceLoopGroup, TraceToolSpan } from './types';

export function toolCallsFromMessages(messages: WorkbenchMessage[]): TraceToolSpan[] {
  const spans: TraceToolSpan[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      spans.push({
        callId: tc.callId,
        toolName: tc.toolName || tc.toolId,
        status: tc.status,
        durationMs: tc.durationMs,
        input: tc.input && typeof tc.input === 'object' ? (tc.input as Record<string, unknown>) : undefined,
        error: tc.error,
        loop: 1,
      });
    }
  }
  return spans;
}

export function groupInvocationsByLoop(
  invocations: { loop: number; tool_name: string; status: string; duration_ms: number; error: string | null; input: unknown; id: string; created_at: Date }[],
): TraceLoopGroup[] {
  const byLoop = new Map<number, TraceToolSpan[]>();
  for (const inv of invocations) {
    const list = byLoop.get(inv.loop) ?? [];
    list.push({
      callId: inv.id,
      toolName: inv.tool_name,
      status: inv.status === 'error' ? 'error' : 'success',
      durationMs: inv.duration_ms,
      input: inv.input && typeof inv.input === 'object' ? (inv.input as Record<string, unknown>) : undefined,
      error: inv.error ?? undefined,
      startedAt: inv.created_at.toISOString(),
      loop: inv.loop,
    });
    byLoop.set(inv.loop, list);
  }
  return [...byLoop.entries()]
    .sort(([a], [b]) => a - b)
    .map(([loop, tools]) => ({ loop, tools }));
}

export function buildLiveTimeline(messages: WorkbenchMessage[]): TraceLoopGroup[] {
  const tools = toolCallsFromMessages(messages);
  if (tools.length === 0) return [];
  return [{ loop: 1, tools }];
}

export function detectStuckTools(spans: TraceToolSpan[], isStreaming: boolean): boolean {
  if (!isStreaming) return false;
  return spans.some((s) => s.status === 'running');
}
