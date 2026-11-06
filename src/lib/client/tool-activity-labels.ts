import type { ToolCall } from '@/components/agent-lab/workbench/types';

/** User-facing label while a tool runs (no raw tool ids). */
export function friendlyToolActivityLabel(toolName: string | undefined): string {
  const raw = (toolName ?? '').replace(/^Databricks:\s*/i, '').trim().toLowerCase();
  if (!raw) return 'Analyzing your question';
  if (raw.includes('describe_schema') || raw === 'describe schema') return 'Reviewing the data catalog';
  if (raw.includes('execute_tool') || raw.includes('query') || raw.includes('sql')) return 'Querying data';
  if (raw.includes('export')) return 'Preparing export';
  if (raw.includes('search') || raw.includes('catalog')) return 'Searching available data';
  return 'Analyzing your question';
}

/** Short status for the in-flight tool step list (members / dev mode off). */
export function friendlyActivityStatus(toolCalls: ToolCall[], isStreaming: boolean): string {
  const running = toolCalls.find((t) => t.status === 'running' || t.status === 'suggested');
  if (running) return friendlyToolActivityLabel(running.toolName || running.toolId);
  if (isStreaming) {
    if (toolCalls.some((t) => t.status === 'error')) return 'Something needs attention';
    if (toolCalls.length > 0 && toolCalls.every((t) => t.status === 'success')) return 'Writing your answer';
    return 'Analyzing your question';
  }
  return 'Working';
}
