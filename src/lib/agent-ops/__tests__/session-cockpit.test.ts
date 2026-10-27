import { describe, expect, it } from 'vitest';
import { buildSessionCockpit } from '../session-cockpit';
import type { WorkbenchMessage } from '@/components/agent-lab/workbench/types';

describe('buildSessionCockpit', () => {
  it('aggregates tool analytics from invocations', () => {
    const messages: WorkbenchMessage[] = [
      { id: 'u1', role: 'user', content: 'hello', timestamp: 1000, turnNumber: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        timestamp: 2000,
        turnNumber: 1,
        turnOps: {
          durationMs: 5000,
          inputTokens: 100,
          outputTokens: 50,
          loopCount: 2,
          outcome: 'completed',
          modelName: 'Test',
        },
      },
    ];
    const cockpit = buildSessionCockpit({
      messages,
      invocations: [
        {
          id: '1',
          loop: 1,
          tool_name: 'execute_tool',
          status: 'success',
          duration_ms: 1200,
          error: null,
          input: { statement: 'SELECT 1' },
          output: null,
          model: 'm1',
          created_at: new Date(1500),
        },
        {
          id: '2',
          loop: 2,
          tool_name: 'execute_tool',
          status: 'error',
          duration_ms: 300,
          error: 'fail',
          input: {},
          output: null,
          model: 'm1',
          created_at: new Date(1800),
        },
      ],
      costRows: [],
      banditRows: [],
    });
    expect(cockpit.analytics.turnCount).toBe(1);
    expect(cockpit.analytics.totalInputTokens).toBe(100);
    expect(cockpit.toolAnalytics[0].toolName).toBe('execute_tool');
    expect(cockpit.toolAnalytics[0].calls).toBe(2);
    expect(cockpit.toolAnalytics[0].errors).toBe(1);
  });

  it('attaches server turn metrics and fills missing turnOps from them', () => {
    const messages: WorkbenchMessage[] = [
      { id: 'u1', role: 'user', content: 'q1', timestamp: 1000, turnNumber: 1 },
      { id: 'a1', role: 'assistant', content: 'a1', timestamp: 2000, turnNumber: 1 },
      { id: 'u2', role: 'user', content: 'q2', timestamp: 10_000, turnNumber: 2 },
      { id: 'a2', role: 'assistant', content: 'a2', timestamp: 12_000, turnNumber: 2 },
    ];
    const loopRow = (turn_id: string, loop: number, context_chars: number) => ({
      turn_id,
      loop,
      started_at: new Date(1100 + loop),
      llm_ms: 800,
      first_token_ms: 200,
      tool_ms: 400,
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_tokens: 600,
      cache_write_tokens: 0,
      context_messages: loop * 2,
      context_chars,
      tool_calls: 1,
      stop_reason: 'tool_use',
    });
    const cockpit = buildSessionCockpit({
      messages,
      invocations: [
        // Logged against turn 2's id even though its timestamp falls in turn 1's window.
        { id: 'x', loop: 1, tool_name: 'describe_schema', status: 'success', duration_ms: 400, error: null, input: {}, output: null, model: null, created_at: new Date(1200), run_id: 't2' },
      ],
      costRows: [],
      banditRows: [],
      turnRows: [
        { turn_id: 't1', started_at: new Date(1050), duration_ms: 2500, first_token_ms: 900, llm_ms: 1600, tool_ms: 800, loops: 2, tool_calls: 2, tool_errors: 0, input_tokens: 2000, output_tokens: 100, cache_read_tokens: 1200, cache_write_tokens: 0, peak_context_chars: 9000, outcome: 'completed', model: 'grok', error: null },
        { turn_id: 't2', started_at: new Date(10_050), duration_ms: 1500, first_token_ms: 300, llm_ms: 1000, tool_ms: 400, loops: 1, tool_calls: 1, tool_errors: 0, input_tokens: 500, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, peak_context_chars: 4000, outcome: 'truncated', model: 'grok', error: null },
      ],
      loopRows: [loopRow('t1', 2, 9000), loopRow('t1', 1, 5000)],
    });

    const [t1, t2] = cockpit.turns;
    expect(t1.server?.turnId).toBe('t1');
    expect(t1.server?.loopMetrics.map((l) => l.loop)).toEqual([1, 2]);
    expect(t1.turnOps?.durationMs).toBe(2500);
    expect(t2.turnOps?.outcome).toBe('truncated');
    expect(t1.invocations).toHaveLength(0);
    expect(t2.invocations.map((i) => i.id)).toEqual(['x']);
    expect(cockpit.analytics.totalTurnDurationMs).toBe(4000);
    expect(cockpit.analytics.server).toMatchObject({ turnsCovered: 2, cacheReadTokens: 1200, avgFirstTokenMs: 600, peakContextChars: 9000 });
  });
});
