import type { ArtifactType, ArtifactDraft } from '@/lib/agent-lab/artifactDraftSchemas';
import type { ConstructionState } from '@/lib/construction/constructionState';

export type { ArtifactType, ArtifactDraft };
export type { DraftValidationError } from '@/lib/agent-lab/artifactDraftSchemas';

/** Persisted on assistant messages after each completed stream (`done`). */
export interface TurnOpsSnapshot {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  loopCount: number;
  outcome: 'completed' | 'truncated' | 'errored';
  modelKey?: string;
  modelName?: string;
  contextMode?: 'harvested' | 'warehouse_only';
  firstTokenMs?: number | null;
}

export interface WorkbenchMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  /** Server/client turn metrics for Agent Ops cockpit. */
  turnOps?: TurnOpsSnapshot;
  thinking?: string;
  /** Latest server activity; only used while this response is streaming. */
  activity?: 'thinking' | 'writing';
  draftPatches?: JsonPatch[];
  suggestions?: CatalogSuggestion[];
  followUpSuggestions?: string[];
  timestamp: number;
  turnNumber: number;
}

export interface ToolCall {
  callId: string;
  toolId: string;
  toolName: string;
  status: 'suggested' | 'running' | 'success' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
  retryable?: boolean;
  durationMs?: number;
  reason?: string;
}

export interface JsonPatch {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export interface CatalogSuggestion {
  type: 'tool' | 'schema' | 'agent' | 'prompt' | 'bus_contract';
  id: string;
  name: string;
  reason: string;
  accepted?: boolean;
}

export interface EvalResult {
  input: unknown;
  expectedOutput: unknown;
  actualOutput: unknown;
  pass: boolean;
  score: number;
  latencyMs: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
  contractId: string;
  messageType: string;
}

export interface CompatIssue {
  field: string;
  expected: string;
  actual: string;
  severity: 'error' | 'warning';
}

export type WorkbenchEvent =
  | { type: 'text'; delta: string }
  | { type: 'text_replace'; text: string }
  | { type: 'thinking'; delta: string }
  | { type: 'stream_start'; model: string; modelKey: string; supportsThinking: boolean; maxLoops: number }
  | { type: 'loop_start'; loop: number; maxLoops: number }
  | { type: 'loop_usage'; loop: number; inputTokens: number; outputTokens: number; totalInputTokens: number; totalOutputTokens: number; responseLength: number }
  | { type: 'tool_call_suggested'; callId: string; toolId: string; toolName: string; reason: string }
  | { type: 'tool_call_running'; callId: string; toolId: string; input: unknown }
  | { type: 'tool_call_result'; callId: string; output: unknown; durationMs: number }
  | { type: 'tool_call_error'; callId: string; error: string; retryable: boolean }
  | { type: 'agent_draft_patch'; patch: JsonPatch[]; turn: number }
  | { type: 'schema_suggestion'; ref: string; reason: string }
  | { type: 'validation'; field: string; severity: 'error' | 'warn'; message: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number }; model?: string; loops?: number; toolCallsCount?: number }
  | { type: 'error'; message: string; recoverable: boolean }
  // Multi-artifact SSE events
  | { type: 'tool_code_delta'; delta: string; language: 'typescript' | 'python' }
  | { type: 'schema_tree_update'; schemaRef: string; tree: object }
  | { type: 'prompt_diff'; before: string; after: string; reason: string }
  | { type: 'prompt_eval_result'; results: EvalResult[]; summary: { passed: number; total: number; avgScore: number } }
  | { type: 'bus_topology_update'; contracts: unknown[]; edges: TopologyEdge[] }
  | { type: 'compatibility_check'; status: 'compatible' | 'incompatible' | 'partial'; issues: CompatIssue[] }
  | { type: 'linked_session_created'; sessionId: string; artifactType: ArtifactType }
  | { type: 'artifact_saved'; artifactId: string; artifactType: ArtifactType; catalogUrl: string }
  | { type: 'progress_update'; completed: number; total: number }
  | { type: 'suggestions'; items: string[] }
  | { type: 'readiness'; value: 'interview' | 'plan' | 'build' }
  // R5 builder construction events
  | { type: 'agent_construction_patch'; field: string; value: unknown; source: string }
  | { type: 'class_suggestion'; classId: string; confidence: number; rationale: string };

export interface StreamLogEntry {
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface WorkbenchSession {
  id: string;
  title: string | null;
  messages: WorkbenchMessage[];
  attachedTools: string[];
  attachedSchemas: string[];
  attachedAgents: string[];
  draft: ArtifactDraft | null;
  artifactType: ArtifactType;
  artifactDraft: ArtifactDraft | null;
  pinned: boolean;
  progress: { completed_fields?: number; total_fields?: number; last_model?: string; [key: string]: unknown } | null;
  savedAgentId: string | null;
  parentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  constructionState: ConstructionState | null;
  modality: string | null;
  readiness: string | null;
}

export interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

export interface WorkbenchChatRequest {
  sessionId: string;
  messages: WorkbenchMessage[];
  attachedTools: string[];
  attachedSchemas: string[];
  attachedAgents: string[];
  draft: ArtifactDraft | null;
  artifactType: ArtifactType;
  model?: string;
  sampleInputs?: Record<string, unknown>;
}

export interface ModelOption {
  key: string;
  label: string;
  provider: 'anthropic' | 'mistral' | 'openai' | 'xai' | 'moonshot' | 'deepseek' | 'qwen' | 'llmlite';
  bedrockId: string;
  supportsTools: boolean;
  supportsThinking: boolean;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  // LLM Lite gateway only — live list is fetched from the gateway; this is the static fallback.
  { key: 'llm-lite:aws_bedrock--xAI-Grok-4.7', label: 'Grok 4.7 (LLM Lite)', provider: 'llmlite', bedrockId: 'aws_bedrock/xAI-Grok-4.7', supportsTools: true, supportsThinking: false, description: 'Synergy LLM Lite gateway · aws_bedrock/xAI-Grok-4.7' },
];
