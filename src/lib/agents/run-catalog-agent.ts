import 'server-only';

import type { ContentBlock, Message, Tool } from '@aws-sdk/client-bedrock-runtime';
import { prisma } from '@/lib/db';
import { runAgentLoop, type AgentLoopParams, type AgentLoopResult, type LoopMetrics, type ToolCallEvent } from '@/lib/inspector/agent-loop';
import { dispatchAgentLoop } from '@/lib/inspector/providers/factory';
import { INSPECTOR_TOOLS } from '@/lib/inspector/prompts';
import { executeInspectorTool, resolveToolCatalogEntry } from '@/lib/inspector/tools';
import { principalForUser } from '@/lib/access/principal';
import type { QueryResult } from '@/hooks/useInspectorChat';
import { withAgentOpsToolLog } from '@/lib/agent-ops/log-tool-invocation';
import { TurnMetricsRecorder } from '@/lib/agent-ops/record-turn-metrics';
import { buildRuntimeSystemPrompt } from '@/lib/construction/prompts';
import { runtimeBriefFromCatalog } from '@/lib/construction/catalog-sync';
import { resolveWorkbenchModel } from '@/lib/construction/workbench-model';
import { computeCostUsd, logAgentCost } from '@/lib/lifecycle/log-agent-cost';
import { recordInteractiveLlmSpend } from '@/lib/spend/record-spend-event';
import { assertInteractiveBudget, BudgetExceededError } from '@/lib/spend/budgets';
import { checkCustomFields, typeFieldValue, type CustomField } from '@/lib/extraction/schemas';
import { getDefaultOrg } from '@/lib/org';
import { knowledgeForAgent, knowledgePrompt, runSearchKnowledgeTool, searchKnowledgeTool, SEARCH_KNOWLEDGE_TOOL } from '@/lib/knowledge/agents';
import { INSPECTION_PROMPT, parseInspection, RECORD_INSPECTION_TOOL, type AgentInspection } from '@/lib/agents/inspection';

// Runs one turn of a saved agent from the agent catalog: its instructions as the system prompt and
// the read-only data tools (describe_schema, execute_tool). Shared by agent chat and by Automate's
// "Ask an agent" step, so both run agents the same way and both record what a run used: tokens,
// rounds, tool calls, duration and outcome go to agent_turn_log / agent_loop_log (surface tells
// them apart), and the cost is computed from ALOFT's price table.
//
// Knowledge: an agent linked to knowledge bases also gets `search_knowledge` over the linked ones
// the person running it may search (src/lib/knowledge/agents.ts), and is told to cite (document, page).
//
// Optional answer fields: the agent must finish by calling `submit_answer` with exactly those
// fields, typed the same way as document extraction (real dates, numbers), so later steps can
// filter, compare and approve on them instead of reading free text.

export const AGENT_TOOLS = new Set(['describe_schema', 'execute_tool']);
export const AGENT_MAX_LOOPS = 10;
export const SUBMIT_ANSWER_TOOL = 'submit_answer';

export type AgentTurn = { role: 'user' | 'assistant'; content: string };

export class AgentRunError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

export type AgentAnswer = {
  /** Field key to typed value (null when the agent did not know). */
  values: Record<string, string | number | null>;
  /** Fields with no accepted value. */
  missing: string[];
  /** Values the agent gave that were not accepted, e.g. a date that is not a real date. */
  issues: Record<string, string>;
  /** The agent's short explanation, if it gave one. */
  notes: string | null;
};

export type RunCatalogAgentInput = {
  slug: string;
  message: string;
  history?: AgentTurn[];
  /** Session role, for the model choice (same rules as the Workbench). */
  role: string | null | undefined;
  model?: string;
  answer?: CustomField[];
  /** agent_turn_log.surface: `agent_use` (chat) or `automation`. */
  surface: string;
  /** Saved chat this turn belongs to; metrics and tool logs are keyed by it. Defaults to the agent id. */
  sessionId?: string;
  /** Who is running it: linked knowledge bases are searched only as far as this person may. None = organisation ones only. */
  person?: { userId: string; role: string } | null;
  /** Agent chat only: record tables, join, and caveats beside the reply, for an admin to inspect. */
  captureInspection?: boolean;
  abort?: { value: boolean };
  onTextChunk?: (delta: string) => void;
  onToolCallEvent?: (event: ToolCallEvent) => void;
  /** Every event the data tools emit (e.g. query results), for streaming callers. */
  onToolEvent?: (event: Record<string, unknown>) => void;
};

export type RunCatalogAgentResult = {
  agent: { id: string; name: string; slug: string; status: string | null };
  model: string;
  /** Knowledge bases the agent could search in this run. */
  knowledgeBases: string[];
  outcome: AgentLoopResult['outcome'];
  text: string;
  /** Tables, join, and caveats. Null when the agent did not record one. */
  inspection: AgentInspection | null;
  answer: AgentAnswer | null;
  /** Why answer fields were asked for but none came back. */
  answerProblem?: string;
  errorDetail?: string;
  usage: AgentLoopResult['usage'];
  loops: number;
  toolCalls: number;
  costUsd: number;
  durationMs: number;
  turnId: string;
};

function inspectionTool(): Tool {
  return {
    toolSpec: {
      name: RECORD_INSPECTION_TOOL,
      description: 'Record the tables, join, and caveats behind this answer for an administrator. Call once, before the final reply. Do not put this note in the reply.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            sources: { type: 'string', description: 'Tables queried, one fully qualified path per line.' },
            joins: { type: 'string', description: 'Join used, and whether the catalog verifies it.' },
            caveats: { type: 'string', description: 'Gaps or assumptions that change how much to trust the answer.' },
          },
          required: ['sources'],
        },
      },
    },
  };
}

function answerTool(fields: CustomField[]): Tool {
  return {
    toolSpec: {
      name: SUBMIT_ANSWER_TOOL,
      description: 'Give your final answer as these exact fields. Call this once, when you are done. Use null for anything you could not establish; never guess.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            values: {
              type: 'object',
              properties: Object.fromEntries(
                fields.map((f) => [f.key, { type: ['string', 'number', 'null'], description: `${f.label ? `${f.label}: ` : ''}${f.description}${f.type === 'date' ? ' (YYYY-MM-DD)' : f.type === 'number' ? ' (a number)' : ''}` }]),
              ),
              required: fields.map((f) => f.key),
            },
            notes: { type: 'string', description: 'One or two sentences: how you got the answer, or what was missing.' },
          },
          required: ['values'],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    },
  };
}

/** Types the submitted values field by field. Unknown keys are ignored. */
export function parseAgentAnswer(fields: CustomField[], raw: unknown): AgentAnswer {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { values?: unknown; notes?: unknown };
  const given = (input.values && typeof input.values === 'object' ? input.values : {}) as Record<string, unknown>;
  const values: AgentAnswer['values'] = {};
  const issues: AgentAnswer['issues'] = {};
  for (const f of fields) {
    const typed = typeFieldValue(f.type, given[f.key]);
    values[f.key] = typed.value;
    if (typed.issue) issues[f.key] = typed.issue;
  }
  return {
    values,
    missing: fields.filter((f) => values[f.key] === null).map((f) => f.key),
    issues,
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 1000) : null,
  };
}

/** Some providers write the tool call as JSON text instead of calling it; accept a whole JSON object with `values`. */
function answerWrittenAsText(text: string): unknown {
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (!body.startsWith('{')) return null;
  try {
    const v = JSON.parse(body) as { values?: unknown };
    return v && typeof v === 'object' && v.values && typeof v.values === 'object' ? v : null;
  } catch {
    return null;
  }
}

export async function runCatalogAgent(input: RunCatalogAgentInput): Promise<RunCatalogAgentResult> {
  if (input.answer) {
    const problems = checkCustomFields(input.answer);
    if (problems.length) throw new AgentRunError(422, `The answer fields are not valid: ${problems.join('; ')}`);
  }
  const resolved = resolveWorkbenchModel(input.model, input.role, 'commissioned_agents');
  if (!resolved) throw new AgentRunError(400, 'Model not available');
  const { option, boostModel, effectiveModelId } = resolved;

  const agent = await prisma.agent_catalog.findFirst({ where: { slug: input.slug } });
  if (!agent) throw new AgentRunError(404, 'Agent not found');
  const brief = runtimeBriefFromCatalog(agent);
  if (!brief) throw new AgentRunError(400, 'This agent has no instructions to run.');

  const platformAgentId =
    agent.config && typeof agent.config === 'object' && !Array.isArray(agent.config) && typeof (agent.config as { platformAgentId?: unknown }).platformAgentId === 'string'
      ? (agent.config as { platformAgentId: string }).platformAgentId
      : null;
  if (platformAgentId) {
    void prisma.platformAgent
      .update({ where: { id: platformAgentId }, data: { last_activity: new Date() } })
      .catch((err) => console.error('[agents] last_activity update failed', err));
  }

  let connectionId: string | null = null;
  try {
    const entry = await resolveToolCatalogEntry('');
    connectionId = (entry?.config as Record<string, string> | null)?.connection_id ?? null;
  } catch {
    /* no warehouse — describe_schema still works */
  }

  const orgId = getDefaultOrg().id;
  const dataPrincipal = input.person?.userId
    ? await principalForUser(input.person.userId, orgId)
    : null;
  try {
    await assertInteractiveBudget({
      orgId,
      userId: input.person?.userId ?? null,
      role: input.role ?? null,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      throw new AgentRunError(402, err.message);
    }
    throw err;
  }

  const knowledge = await knowledgeForAgent(agent.id, input.person ? { ...input.person, orgId } : null, orgId).catch((e: unknown) => {
    console.warn('[agents] linked knowledge unavailable:', e instanceof Error ? e.message.slice(0, 200) : e);
    return [];
  });

  const fields = input.answer ?? null;
  const captureInspection = input.captureInspection === true;
  const messages: Message[] = [
    ...(input.history ?? []).map((t) => ({ role: t.role, content: [{ text: t.content } as ContentBlock] })),
    { role: 'user' as const, content: [{ text: input.message } as ContentBlock] },
  ];
  const systemPrompt = [
    buildRuntimeSystemPrompt({ ...brief, mode: 'live' }),
    knowledgePrompt(knowledge),
    captureInspection ? `\n\n${INSPECTION_PROMPT}` : '',
    fields
      ? `\n\nFINAL ANSWER: when you are done, call ${SUBMIT_ANSWER_TOOL} once with every field (${fields.map((f) => f.key).join(', ')}). Use null for anything you could not establish from the data; never guess. Dates as YYYY-MM-DD, numbers as numbers.`
      : '',
  ].join('');

  const runSessionId = input.sessionId ?? agent.id;
  const metrics = new TurnMetricsRecorder({ sessionId: runSessionId, surface: input.surface });
  const abort = input.abort ?? { value: false };
  const queryResults: QueryResult[] = [];
  let submitted: unknown = null;
  let inspection: AgentInspection | null = null;
  const inspectionCallIds = new Set<string>();
  let toolCalls = 0;
  let toolErrors = 0;
  const started = Date.now();

  const loop: AgentLoopParams = {
    modelId: effectiveModelId,
    systemPrompt,
    messages,
    tools: {
      tools: [
        ...INSPECTOR_TOOLS.filter((t) => AGENT_TOOLS.has(t.toolSpec?.name ?? '')),
        ...(knowledge.length ? [searchKnowledgeTool(knowledge)] : []),
        ...(captureInspection ? [inspectionTool()] : []),
        ...(fields ? [answerTool(fields)] : []),
      ],
    },
    executeTool: (toolName, toolInput, callId) => {
      if (captureInspection && toolName === RECORD_INSPECTION_TOOL) {
        inspection = parseInspection(toolInput) ?? inspection;
        return Promise.resolve('Recorded. Write the answer for the person who asked. Do not repeat these notes.');
      }
      if (fields && toolName === SUBMIT_ANSWER_TOOL) {
        submitted = toolInput;
        abort.value = true; // the answer is in; skip the follow-up call
        return Promise.resolve('Answer received.');
      }
      if (toolName === SEARCH_KNOWLEDGE_TOOL && knowledge.length) {
        toolCalls++;
        return withAgentOpsToolLog({ sessionId: runSessionId, runId: metrics.turnId, loop: 0, toolName, callId, model: effectiveModelId }, toolInput, () =>
          runSearchKnowledgeTool(toolInput, knowledge, { orgId, userId: input.person?.userId ?? null, surface: input.surface === 'automation' ? 'automation' : 'agent' }),
        );
      }
      if (!AGENT_TOOLS.has(toolName)) return Promise.resolve(JSON.stringify({ error: `Tool ${toolName} is not available when using this agent` }));
      toolCalls++;
      return withAgentOpsToolLog({ sessionId: runSessionId, runId: metrics.turnId, loop: 0, toolName, callId, model: effectiveModelId }, toolInput, () =>
        executeInspectorTool(
          toolName,
          toolInput,
          callId,
          (event: Record<string, unknown>) => {
            if (event.type === 'query_result') queryResults.push(event as unknown as QueryResult);
            input.onToolEvent?.(event);
          },
          { queryResults, model: effectiveModelId, lastUserMessage: input.message, sessionId: runSessionId, connectionId, dataPrincipal },
        ),
      );
    },
    maxLoops: AGENT_MAX_LOOPS + (fields ? 1 : 0) + (captureInspection ? 1 : 0),
    supportsTools: option.supportsTools,
    supportsThinking: false,
    abortSignal: abort,
    onTextChunk: (delta) => {
      metrics.markFirstToken();
      input.onTextChunk?.(delta);
    },
    onToolCallEvent: (event) => {
      if ('toolName' in event && event.toolName === RECORD_INSPECTION_TOOL) {
        inspectionCallIds.add(event.callId);
        return;
      }
      if ('callId' in event && inspectionCallIds.has(event.callId)) return;
      if (event.type === 'tool_call_error') toolErrors++;
      input.onToolCallEvent?.(event);
    },
    onLoopMetrics: (m: LoopMetrics) => metrics.addLoop(m),
  };

  let result: AgentLoopResult;
  try {
    result = boostModel ? await dispatchAgentLoop(boostModel, loop) : await runAgentLoop(loop);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent run failed';
    void metrics.flush({ model: effectiveModelId, outcome: 'errored', toolCalls, toolErrors, error: message });
    throw err;
  }

  const text = result.finalText?.trim() ?? '';
  let answer: AgentAnswer | null = null;
  let answerProblem: string | undefined;
  if (fields) {
    const raw = submitted ?? answerWrittenAsText(text);
    if (raw) answer = parseAgentAnswer(fields, raw);
    else answerProblem = 'The agent did not return the answer fields.';
  }
  // An answer that arrived ends the run as intended, even though the loop was stopped early.
  const outcome: AgentLoopResult['outcome'] = answer && result.outcome !== 'errored' ? 'completed' : result.outcome;
  void metrics.flush({ model: effectiveModelId, outcome, toolCalls, toolErrors, error: result.errorDetail ?? null });

  const costUsd = computeCostUsd(effectiveModelId, result.usage.inputTokens, result.usage.outputTokens);
  const spendUserId = input.person?.userId ?? null;
  const spendStatus = outcome === 'errored' ? 'failed' : outcome === 'truncated' ? 'truncated' : 'success';
  void logAgentCost({
    agentName: `catalog:${input.slug}`,
    agentVersion: '1.0.0',
    runId: runSessionId,
    model: effectiveModelId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    toolCalls,
    durationMs: Date.now() - started,
    status: spendStatus === 'failed' ? 'failed' : 'success',
  }).catch(() => {});
  void recordInteractiveLlmSpend({
    orgId,
    userId: spendUserId,
    surface: input.surface,
    model: effectiveModelId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    sessionId: runSessionId,
    turnId: metrics.turnId,
    agentSlug: input.slug,
    status: spendStatus,
    durationMs: Date.now() - started,
    toolCalls,
  }).catch(() => {});

  return {
    agent: { id: agent.id, name: agent.name, slug: input.slug, status: agent.status ?? null },
    model: effectiveModelId,
    knowledgeBases: knowledge.map((k) => k.name),
    outcome,
    text,
    inspection,
    answer,
    answerProblem,
    errorDetail: result.errorDetail,
    usage: result.usage,
    loops: result.loops,
    toolCalls,
    costUsd: computeCostUsd(effectiveModelId, result.usage.inputTokens, result.usage.outputTokens),
    durationMs: Date.now() - started,
    turnId: metrics.turnId,
  };
}
