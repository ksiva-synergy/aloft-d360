import type { ToolCall, TurnOpsSnapshot } from '@/components/agent-lab/workbench/types';

export type CompanionState = 'idle' | 'reading' | 'thinking' | 'tools' | 'writing' | 'success' | 'clarification' | 'error' | 'stopped';
export interface CompanionActivity { state: CompanionState; label: string }
export interface ActivityInput {
  isStreaming: boolean;
  content?: string;
  thinking?: string;
  activity?: 'thinking' | 'writing';
  toolCalls?: ToolCall[];
  interrupted?: boolean;
  error?: string | null;
  outcome?: TurnOpsSnapshot['outcome'];
  needsClarification?: boolean;
}

/** Use explicit lifecycle facts, never infer a question or success from generated prose. */
export function companionActivity(input: ActivityInput): CompanionActivity {
  if (!input.isStreaming) {
    if (input.interrupted) return { state: 'stopped', label: 'Stopped' };
    if (input.error || input.outcome === 'errored') return { state: 'error', label: 'Response needs attention' };
    if (input.outcome === 'truncated') return { state: 'stopped', label: 'Response paused at its limit' };
    if (input.toolCalls?.some(tool => tool.status === 'error')) return { state: 'error', label: 'Completed with a tool error' };
    if (input.needsClarification) return { state: 'clarification', label: 'Waiting for your input' };
    return input.content ? { state: 'success', label: 'Response ready' } : { state: 'idle', label: 'Ready to help' };
  }
  const running = input.toolCalls?.find(tool => tool.status === 'running');
  if (running) return { state: 'tools', label: `Using ${running.toolName || running.toolId || 'a tool'}` };
  if (input.toolCalls?.some(tool => tool.status === 'suggested')) return { state: 'tools', label: 'Preparing a tool' };
  if (input.activity === 'thinking') return { state: 'thinking', label: 'Thinking it through' };
  if (input.content) return { state: 'writing', label: 'Writing a response' };
  if (input.thinking) return { state: 'thinking', label: 'Thinking it through' };
  return { state: 'reading', label: 'Reading your message' };
}
