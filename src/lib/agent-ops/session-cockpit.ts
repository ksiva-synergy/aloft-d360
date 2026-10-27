import type { WorkbenchMessage, ToolCall, TurnOpsSnapshot } from '@/components/agent-lab/workbench/types';
import { computeCostUsd } from '@/lib/lifecycle/log-agent-cost';
import type { TraceLoopGroup } from './types';
import { groupInvocationsByLoop } from './build-timeline';

export interface InvocationRow {
  id: string;
  turnIndex: number;
  loop: number;
  toolName: string;
  status: string;
  durationMs: number;
  error: string | null;
  model: string | null;
  createdAt: string;
  input: unknown;
  output: unknown;
  /** Server turn id (tool_invocation_log.run_id) when logged with turn metrics. */
  runId?: string | null;
}

/** One LLM call inside a turn (agent_loop_log). */
export interface LoopMetricsView {
  loop: number;
  startedAt: string;
  llmMs: number;
  firstTokenMs: number | null;
  toolMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextMessages: number;
  contextChars: number;
  toolCalls: number;
  stopReason: string | null;
}

/** Server-recorded turn timing (agent_turn_log). Null for turns before it was recorded. */
export interface TurnServerMetrics {
  turnId: string;
  startedAt: string;
  durationMs: number;
  firstTokenMs: number | null;
  llmMs: number;
  toolMs: number;
  loops: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  peakContextChars: number;
  outcome: string;
  model: string | null;
  error: string | null;
  loopMetrics: LoopMetricsView[];
}

export interface ToolAnalyticsRow {
  toolName: string;
  calls: number;
  errors: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastCalledAt: string | null;
}

export interface SessionTurnView {
  turnIndex: number;
  assistantMessageId: string;
  userExcerpt: string;
  assistantExcerpt: string;
  timestamp: number;
  turnOps: TurnOpsSnapshot | null;
  toolCallsFromMessage: ToolCall[];
  invocations: InvocationRow[];
  toolCallCount: number;
  errorCount: number;
  server: TurnServerMetrics | null;
}

export interface SessionAnalytics {
  turnCount: number;
  totalToolCalls: number;
  toolErrors: number;
  toolSuccessRate: number;
  totalToolDurationMs: number;
  avgToolDurationMs: number;
  p95ToolDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTurnDurationMs: number;
  estimatedCostUsd: number;
  modelsUsed: string[];
  outcomes: { completed: number; truncated: number; errored: number };
  invocationSource: 'database' | 'messages' | 'mixed' | 'bandit' | 'none';
  /** Aggregates over turns that have server metrics; null when none do (older sessions). */
  server: {
    turnsCovered: number;
    durationMs: number;
    llmMs: number;
    toolWallMs: number;
    avgFirstTokenMs: number | null;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    inputTokens: number;
    peakContextChars: number;
  } | null;
}

export interface BanditSummary {
  id: string;
  sourceRunId: string | null;
  outcome: string | null;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  toolCallsTotal: number;
  toolCallsError: number;
  durationMs: number;
  compositeScore: number | null;
  scoreC: number | null;
  scoreT: number | null;
  scoreS: number | null;
  scoreG: number | null;
}

export interface CostLogSummary {
  id: string;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string | null;
  durationMs: number | null;
  toolCalls: number | null;
  status: string | null;
}

export interface SessionCockpitPayload {
  analytics: SessionAnalytics;
  turns: SessionTurnView[];
  toolAnalytics: ToolAnalyticsRow[];
  chronology: InvocationRow[];
  loops: TraceLoopGroup[];
  bandit: BanditSummary[];
  costLog: CostLogSummary[];
}

type RawInvocation = {
  id: string;
  loop: number;
  tool_name: string;
  status: string;
  duration_ms: number;
  error: string | null;
  input: unknown;
  output: unknown;
  model: string | null;
  created_at: Date;
  run_id?: string | null;
};

type RawTurnRow = {
  turn_id: string;
  started_at: Date;
  duration_ms: number;
  first_token_ms: number | null;
  llm_ms: number;
  tool_ms: number;
  loops: number;
  tool_calls: number;
  tool_errors: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  peak_context_chars: number;
  outcome: string;
  model: string | null;
  error: string | null;
};

type RawLoopRow = {
  turn_id: string;
  loop: number;
  started_at: Date;
  llm_ms: number;
  first_token_ms: number | null;
  tool_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  context_messages: number;
  context_chars: number;
  tool_calls: number;
  stop_reason: string | null;
};

function toServerMetrics(row: RawTurnRow, loops: RawLoopRow[]): TurnServerMetrics {
  return {
    turnId: row.turn_id,
    startedAt: row.started_at.toISOString(),
    durationMs: row.duration_ms,
    firstTokenMs: row.first_token_ms,
    llmMs: row.llm_ms,
    toolMs: row.tool_ms,
    loops: row.loops,
    toolCalls: row.tool_calls,
    toolErrors: row.tool_errors,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    peakContextChars: row.peak_context_chars,
    outcome: row.outcome,
    model: row.model,
    error: row.error,
    loopMetrics: loops
      .filter((l) => l.turn_id === row.turn_id)
      .sort((a, b) => a.loop - b.loop)
      .map((l) => ({
        loop: l.loop,
        startedAt: l.started_at.toISOString(),
        llmMs: l.llm_ms,
        firstTokenMs: l.first_token_ms,
        toolMs: l.tool_ms,
        inputTokens: l.input_tokens,
        outputTokens: l.output_tokens,
        cacheReadTokens: l.cache_read_tokens,
        cacheWriteTokens: l.cache_write_tokens,
        contextMessages: l.context_messages,
        contextChars: l.context_chars,
        toolCalls: l.tool_calls,
        stopReason: l.stop_reason,
      })),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function invocationsFromBanditTrajectory(
  banditRows: { id: string; tool_trajectory?: unknown }[],
): RawInvocation[] {
  const rows: RawInvocation[] = [];
  for (const b of banditRows) {
    if (!Array.isArray(b.tool_trajectory)) continue;
    for (const entry of b.tool_trajectory) {
      const t = entry as {
        seq?: number;
        tool?: string;
        status?: string;
        durationMs?: number;
        input?: Record<string, unknown>;
        output?: string | null;
        sqlExcerpt?: string | null;
      };
      if (!t.tool) continue;
      const isErr = t.status === 'error';
      rows.push({
        id: `bandit-${b.id}-${t.seq ?? rows.length}`,
        loop: t.seq ?? 1,
        tool_name: t.tool,
        status: isErr ? 'error' : 'success',
        duration_ms: t.durationMs ?? 0,
        error: isErr ? (typeof t.output === 'string' ? t.output.slice(0, 500) : 'tool error') : null,
        input: t.input ?? (t.sqlExcerpt ? { statement: t.sqlExcerpt } : {}),
        output: t.output,
        model: null,
        created_at: new Date(0),
      });
    }
  }
  return rows;
}

function messageToolToInvocation(tc: ToolCall, turnIndex: number, idx: number): InvocationRow {
  const status =
    tc.status === 'error'
      ? 'error'
      : tc.status === 'success'
        ? 'success'
        : tc.status === 'running'
          ? 'running'
          : 'unknown';
  return {
    id: tc.callId || `msg-${turnIndex}-${idx}`,
    turnIndex,
    loop: 0,
    toolName: tc.toolName || tc.toolId,
    status,
    durationMs: tc.durationMs ?? 0,
    error: tc.error ?? null,
    model: null,
    createdAt: '',
    input: tc.input,
    output: tc.output,
  };
}

export function buildSessionCockpit(params: {
  messages: WorkbenchMessage[];
  invocations: RawInvocation[];
  costRows: {
    id: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: { toString(): string } | number | null;
    model: string | null;
    duration_ms: number | null;
    tool_calls: number | null;
    status: string | null;
    created_at: Date | null;
  }[];
  banditRows: {
    id: string;
    source_run_id: string | null;
    outcome: string | null;
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    tool_calls_total: number;
    tool_calls_error: number;
    duration_ms: number;
    composite_score: number | null;
    score_c: number | null;
    score_t: number | null;
    score_s: number | null;
    score_g: number | null;
    tool_trajectory?: unknown;
  }[];
  turnRows?: RawTurnRow[];
  loopRows?: RawLoopRow[];
}): SessionCockpitPayload {
  const messages = [...params.messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  let rawInvocations = params.invocations;
  if (rawInvocations.length === 0) {
    rawInvocations = invocationsFromBanditTrajectory(params.banditRows);
  }

  const dbRows: InvocationRow[] = rawInvocations.map((i) => ({
    id: i.id,
    turnIndex: 0,
    loop: i.loop,
    toolName: i.tool_name,
    status: i.status,
    durationMs: i.duration_ms,
    error: i.error,
    model: i.model,
    createdAt: i.created_at.toISOString(),
    input: i.input,
    output: i.output,
    runId: i.run_id ?? null,
  }));

  const turnRows = [...(params.turnRows ?? [])].sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
  const usedTurnRows = new Set<string>();

  const turns: SessionTurnView[] = [];
  let turnIndex = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const userExcerpt = (m.content ?? '').slice(0, 200);
    const userTs = m.timestamp ?? 0;
    let assistant: WorkbenchMessage | undefined;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'user') break;
      if (messages[j].role === 'assistant') {
        assistant = messages[j];
        break;
      }
    }
    turnIndex += 1;
    const nextUser = messages.slice(i + 1).find((x) => x.role === 'user');
    const turnEnd = nextUser?.timestamp ?? Number.MAX_SAFE_INTEGER;
    // Server turn row: first unused row that started inside this turn's window.
    const turnRow = turnRows.find((r) => {
      const t = r.started_at.getTime();
      return !usedTurnRows.has(r.turn_id) && t >= userTs && t < turnEnd;
    });
    if (turnRow) usedTurnRows.add(turnRow.turn_id);
    const server = turnRow ? toServerMetrics(turnRow, params.loopRows ?? []) : null;

    const turnInvocations = dbRows.filter((inv) => {
      if (server && inv.runId) return inv.runId === server.turnId;
      if (!inv.createdAt) return false;
      const t = new Date(inv.createdAt).getTime();
      return t >= userTs && t < turnEnd;
    }).map((inv) => ({ ...inv, turnIndex }));

    const fromMsg = (assistant?.toolCalls ?? [])
      .filter((tc) => Boolean(tc.toolName || tc.toolId))
      .map((tc, idx) => messageToolToInvocation(tc, turnIndex, idx));

    const invocationsForTurn =
      turnInvocations.length > 0 ? turnInvocations : fromMsg;

    const errorCount = invocationsForTurn.filter((x) => x.status === 'error').length;

    turns.push({
      turnIndex,
      assistantMessageId: assistant?.id ?? `turn-${turnIndex}`,
      userExcerpt,
      assistantExcerpt: (assistant?.content ?? '').slice(0, 280),
      timestamp: userTs,
      turnOps: assistant?.turnOps ?? (server ? serverToTurnOps(server) : null),
      toolCallsFromMessage: assistant?.toolCalls ?? [],
      invocations: invocationsForTurn,
      toolCallCount: invocationsForTurn.length,
      errorCount,
      server,
    });
  }

  const chronology: InvocationRow[] = dbRows.length > 0
    ? dbRows.map((inv) => {
        const turn = turns.find((t) =>
          t.invocations.some((x) => x.id === inv.id),
        );
        return { ...inv, turnIndex: turn?.turnIndex ?? assignTurnByTime(turns, inv.createdAt) };
      })
    : turns.flatMap((t) => t.invocations);

  const toolMap = new Map<string, ToolAnalyticsRow>();
  for (const inv of chronology) {
    if (!inv.toolName || inv.status === 'unknown' || inv.status === 'suggested') continue;
    const key = inv.toolName;
    const cur = toolMap.get(key) ?? {
      toolName: key,
      calls: 0,
      errors: 0,
      successRate: 1,
      totalDurationMs: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      lastCalledAt: null,
    };
    cur.calls += 1;
    if (inv.status === 'error') cur.errors += 1;
    cur.totalDurationMs += inv.durationMs;
    cur.maxDurationMs = Math.max(cur.maxDurationMs, inv.durationMs);
    if (inv.createdAt && (!cur.lastCalledAt || inv.createdAt > cur.lastCalledAt)) {
      cur.lastCalledAt = inv.createdAt;
    }
    toolMap.set(key, cur);
  }
  const toolAnalytics = [...toolMap.values()]
    .map((r) => ({
      ...r,
      successRate: r.calls > 0 ? (r.calls - r.errors) / r.calls : 1,
      avgDurationMs: r.calls > 0 ? Math.round(r.totalDurationMs / r.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  const durations = chronology.map((c) => c.durationMs).filter((d) => d > 0).sort((a, b) => a - b);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTurnDurationMs = 0;
  const modelsUsed = new Set<string>();
  const outcomes = { completed: 0, truncated: 0, errored: 0 };

  for (const t of turns) {
    if (t.turnOps) {
      totalInputTokens += t.turnOps.inputTokens;
      totalOutputTokens += t.turnOps.outputTokens;
      totalTurnDurationMs += t.turnOps.durationMs;
      if (t.turnOps.modelName) modelsUsed.add(t.turnOps.modelName);
      if (t.turnOps.outcome === 'completed') outcomes.completed += 1;
      else if (t.turnOps.outcome === 'truncated') outcomes.truncated += 1;
      else outcomes.errored += 1;
    }
  }

  if (totalInputTokens === 0 && params.banditRows.length > 0) {
    for (const b of params.banditRows) {
      totalInputTokens += b.input_tokens;
      totalOutputTokens += b.output_tokens;
      modelsUsed.add(b.model_id);
    }
  }

  if (totalInputTokens === 0 && params.costRows.length > 0) {
    for (const c of params.costRows) {
      totalInputTokens += c.input_tokens ?? 0;
      totalOutputTokens += c.output_tokens ?? 0;
      if (c.model) modelsUsed.add(c.model);
    }
  }

  let estimatedCostUsd = 0;
  const primaryModel = [...modelsUsed][0] ?? params.costRows[0]?.model ?? 'claude-sonnet-4';
  if (params.costRows.length > 0) {
    estimatedCostUsd = params.costRows.reduce(
      (s, c) => s + Number(c.cost_usd ?? 0),
      0,
    );
  } else if (totalInputTokens + totalOutputTokens > 0) {
    const srv = summarizeServer(turns);
    estimatedCostUsd = srv
      ? computeCostUsd(primaryModel, srv.inputTokens, totalOutputTokens, {
          readTokens: srv.cacheReadTokens,
          writeTokens: srv.cacheWriteTokens,
        })
      : computeCostUsd(primaryModel, totalInputTokens, totalOutputTokens);
  }

  const totalToolCalls = chronology.filter((c) => c.toolName && c.status !== 'unknown').length;
  const toolErrors = chronology.filter((c) => c.status === 'error').length;
  const totalToolDurationMs = chronology.reduce((s, c) => s + c.durationMs, 0);

  let invocationSource: SessionAnalytics['invocationSource'] = 'none';
  if (params.invocations.length > 0) {
    invocationSource = turns.some((t) => t.toolCallsFromMessage.length > 0) ? 'mixed' : 'database';
  } else if (rawInvocations.length > 0 && params.banditRows.length > 0) {
    invocationSource = 'bandit';
  } else if (chronology.length > 0) {
    invocationSource = 'messages';
  }

  const analytics: SessionAnalytics = {
    turnCount: turns.length,
    totalToolCalls,
    toolErrors,
    toolSuccessRate: totalToolCalls > 0 ? (totalToolCalls - toolErrors) / totalToolCalls : 1,
    totalToolDurationMs,
    avgToolDurationMs: totalToolCalls > 0 ? Math.round(totalToolDurationMs / totalToolCalls) : 0,
    p95ToolDurationMs: percentile(durations, 95),
    totalInputTokens,
    totalOutputTokens,
    totalTurnDurationMs,
    estimatedCostUsd,
    modelsUsed: [...modelsUsed],
    outcomes,
    invocationSource,
    server: summarizeServer(turns),
  };

  const loops = groupInvocationsByLoop(
    rawInvocations.map((i) => ({
      id: i.id,
      loop: i.loop,
      tool_name: i.tool_name,
      status: i.status,
      duration_ms: i.duration_ms,
      error: i.error,
      input: i.input,
      created_at: i.created_at,
    })),
  );

  return {
    analytics,
    turns,
    toolAnalytics,
    chronology,
    loops,
    bandit: params.banditRows.map((b) => ({
      id: b.id,
      sourceRunId: b.source_run_id,
      outcome: b.outcome,
      modelId: b.model_id,
      inputTokens: b.input_tokens,
      outputTokens: b.output_tokens,
      toolCallsTotal: b.tool_calls_total,
      toolCallsError: b.tool_calls_error,
      durationMs: b.duration_ms,
      compositeScore: b.composite_score,
      scoreC: b.score_c,
      scoreT: b.score_t,
      scoreS: b.score_s,
      scoreG: b.score_g,
    })),
    costLog: params.costRows.map((c) => ({
      id: c.id,
      createdAt: c.created_at?.toISOString() ?? '',
      inputTokens: c.input_tokens ?? 0,
      outputTokens: c.output_tokens ?? 0,
      costUsd: Number(c.cost_usd ?? 0),
      model: c.model,
      durationMs: c.duration_ms,
      toolCalls: c.tool_calls,
      status: c.status,
    })),
  };
}

function serverToTurnOps(m: TurnServerMetrics): TurnOpsSnapshot {
  return {
    durationMs: m.durationMs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    loopCount: m.loops,
    outcome: m.outcome === 'completed' || m.outcome === 'truncated' ? m.outcome : 'errored',
    modelName: m.model ?? undefined,
    firstTokenMs: m.firstTokenMs,
  };
}

function summarizeServer(turns: SessionTurnView[]): SessionAnalytics['server'] {
  const covered = turns.map((t) => t.server).filter((m): m is TurnServerMetrics => m !== null);
  if (covered.length === 0) return null;
  const sum = (f: (m: TurnServerMetrics) => number) => covered.reduce((s, m) => s + f(m), 0);
  const ttfts = covered.map((m) => m.firstTokenMs).filter((v): v is number => v != null);
  return {
    turnsCovered: covered.length,
    durationMs: sum((m) => m.durationMs),
    llmMs: sum((m) => m.llmMs),
    toolWallMs: sum((m) => m.toolMs),
    avgFirstTokenMs: ttfts.length ? Math.round(ttfts.reduce((s, v) => s + v, 0) / ttfts.length) : null,
    cacheReadTokens: sum((m) => m.cacheReadTokens),
    cacheWriteTokens: sum((m) => m.cacheWriteTokens),
    inputTokens: sum((m) => m.inputTokens),
    peakContextChars: covered.reduce((mx, m) => Math.max(mx, m.peakContextChars), 0),
  };
}

function assignTurnByTime(turns: SessionTurnView[], createdAt: string): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  for (const turn of turns) {
    const next = turns.find((x) => x.turnIndex === turn.turnIndex + 1);
    const end = next?.timestamp ?? Number.MAX_SAFE_INTEGER;
    if (t >= turn.timestamp && t < end) return turn.turnIndex;
  }
  return turns.length > 0 ? turns[turns.length - 1].turnIndex : 0;
}
