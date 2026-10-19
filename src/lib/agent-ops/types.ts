export type ToolInvocationStatus = 'success' | 'error';

export interface AgentOpsToolLogMeta {
  sessionId: string | null;
  loop: number;
  toolName: string;
  callId: string;
  model?: string;
  runId?: string | null;
}

export interface TraceToolSpan {
  callId: string;
  toolName: string;
  status: 'suggested' | 'running' | 'success' | 'error';
  durationMs?: number;
  input?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  loop?: number;
}

export interface TraceLoopGroup {
  loop: number;
  tools: TraceToolSpan[];
}

export interface RunListItem {
  sessionId: string;
  title: string | null;
  surface: string | null;
  updatedAt: string;
  model: string | null;
  outcome: 'completed' | 'truncated' | 'errored' | 'unknown';
  toolErrorCount: number;
  lastUserExcerpt: string | null;
  stuck: boolean;
}

export interface SessionRunDetail {
  session: {
    id: string;
    title: string | null;
    surface: string | null;
    contextMode: string | null;
  };
  invocations: {
    id: string;
    loop: number;
    toolName: string;
    status: string;
    durationMs: number;
    error: string | null;
    input: unknown;
    output: unknown;
    model: string | null;
    createdAt: string;
  }[];
  links: {
    foerTrace: string;
    inspector: string;
    workbench: string;
  };
}
