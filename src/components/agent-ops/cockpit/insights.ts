import type { InvocationRow, SessionCockpitPayload } from '@/lib/agent-ops/session-cockpit';
import { fmtMs, fmtTokens, fmtUsd, pct, plural, stringify } from './format';

export type InsightKind = 'good' | 'warn' | 'bad' | 'info';
export type InsightIcon = 'check' | 'alert' | 'repeat' | 'coins' | 'timer' | 'layers';

export interface Insight {
  id: string;
  kind: InsightKind;
  icon: InsightIcon;
  title: string;
  detail: string;
  /** Calls this insight is about; the UI opens them in the call inspector. */
  calls?: InvocationRow[];
}

/** Rule-based observations that explain the run without reading every row. */
export function deriveInsights(cockpit: SessionCockpitPayload): Insight[] {
  const a = cockpit.analytics;
  const calls = cockpit.chronology;
  const out: Insight[] = [];
  if (calls.length === 0 && a.turnCount === 0) return out;

  // Failures first — they matter most.
  if (a.toolErrors > 0) {
    const failed = calls.filter((c) => c.status !== 'success');
    const worst = [...cockpit.toolAnalytics].sort((x, y) => y.errors - x.errors)[0];
    out.push({
      id: 'errors',
      kind: 'bad',
      icon: 'alert',
      title: `${plural(a.toolErrors, 'tool call')} failed`,
      detail: worst && worst.errors > 0 ? `${worst.toolName} failed ${worst.errors} of ${worst.calls} times.` : 'Open them to see the error.',
      calls: failed,
    });
  } else if (calls.length > 0) {
    out.push({
      id: 'ok',
      kind: 'good',
      icon: 'check',
      title: `All ${calls.length} tool calls succeeded`,
      detail: `No errors across ${plural(a.turnCount, 'turn')}.`,
    });
  }

  // Exact repeats: same tool, same arguments.
  const byKey = new Map<string, InvocationRow[]>();
  for (const c of calls) {
    if (c.input == null) continue;
    const key = `${c.toolName}::${stringify(c.input)}`;
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const repeats = [...byKey.values()].filter((l) => l.length > 1);
  if (repeats.length > 0) {
    const extra = repeats.reduce((s, l) => s + l.length - 1, 0);
    const wasted = repeats.reduce((s, l) => s + l.slice(1).reduce((t, c) => t + c.durationMs, 0), 0);
    out.push({
      id: 'repeats',
      kind: 'warn',
      icon: 'repeat',
      title: `${plural(extra, 'repeated call')} with identical arguments`,
      detail: `${wasted > 0 ? `${fmtMs(wasted)} spent re-running work already done. ` : ''}Caching these results would save time and tokens.`,
      calls: repeats.flat(),
    });
  }

  // One tool dominating the run.
  const top = [...cockpit.toolAnalytics].sort((x, y) => y.calls - x.calls)[0];
  if (top && calls.length >= 5 && top.calls / calls.length >= 0.5) {
    out.push({
      id: 'dominant',
      kind: 'info',
      icon: 'layers',
      title: `${top.toolName} made ${pct(top.calls, calls.length)} of all calls`,
      detail: `${top.calls} of ${calls.length} calls, ${fmtMs(top.totalDurationMs)} total. ${
        /schema|describe|list_tables|catalog/i.test(top.toolName)
          ? 'Most effort went into discovering the schema; pre-loading it could cut steps.'
          : 'This tool drives most of the run.'
      }`,
      calls: calls.filter((c) => c.toolName === top.toolName),
    });
  }

  // Token / cost shape.
  const totalTok = a.totalInputTokens + a.totalOutputTokens;
  if (totalTok > 0) {
    const inShare = a.totalInputTokens / totalTok;
    out.push({
      id: 'tokens',
      kind: inShare > 0.95 && totalTok > 50_000 ? 'warn' : 'info',
      icon: 'coins',
      title: `${pct(a.totalInputTokens, totalTok)} of tokens were input`,
      detail:
        inShare > 0.9
          ? `Cost (${fmtUsd(a.estimatedCostUsd)}) is driven by context re-sent each loop — ${fmtTokens(a.totalInputTokens)} in vs ${fmtTokens(a.totalOutputTokens)} out. Trimming tool output or history would cut it.`
          : `${fmtTokens(a.totalInputTokens)} in, ${fmtTokens(a.totalOutputTokens)} out, about ${fmtUsd(a.estimatedCostUsd)}.`,
    });
  }

  // Server-recorded timing, cache and context (only for turns recorded after agent_turn_log).
  const srv = a.server;
  if (srv) {
    if (srv.inputTokens > 20_000) {
      const hit = srv.cacheReadTokens / srv.inputTokens;
      out.push({
        id: 'cache',
        kind: hit >= 0.5 ? 'good' : hit < 0.2 ? 'warn' : 'info',
        icon: 'coins',
        title: `${pct(srv.cacheReadTokens, srv.inputTokens)} of input tokens came from the prompt cache`,
        detail:
          hit < 0.2
            ? `${fmtTokens(srv.inputTokens - srv.cacheReadTokens)} input tokens were billed at full price. A stable system prompt and tool list at the front of the context would raise the hit rate.`
            : `${fmtTokens(srv.cacheReadTokens)} tokens were served from the cache at a discount.`,
      });
    }
    if (srv.durationMs > 0) {
      const modelShare = srv.llmMs / srv.durationMs;
      out.push({
        id: 'model-vs-tools',
        kind: 'info',
        icon: 'timer',
        title: `The model took ${pct(srv.llmMs, srv.durationMs)} of turn time, tools ${pct(srv.toolWallMs, srv.durationMs)}`,
        detail: `${fmtMs(srv.llmMs)} generating vs ${fmtMs(srv.toolWallMs)} waiting on tools${
          srv.avgFirstTokenMs != null ? `; first token after ${fmtMs(srv.avgFirstTokenMs)} on average` : ''
        }. ${modelShare > 0.6 ? 'Fewer loops or a faster model would help most.' : 'Faster tools/queries would help most.'}`,
      });
    }
    const growth = cockpit.turns
      .map((t) => t.server?.loopMetrics ?? [])
      .filter((l) => l.length > 1)
      .map((l) => ({ first: l[0].contextChars, last: l[l.length - 1].contextChars }))
      .sort((x, y) => y.last / (y.first || 1) - x.last / (x.first || 1))[0];
    if (growth && growth.last > growth.first * 2) {
      out.push({
        id: 'context-growth',
        kind: growth.last > growth.first * 4 ? 'warn' : 'info',
        icon: 'layers',
        title: `Context grew ${(growth.last / (growth.first || 1)).toFixed(1)}× within a turn`,
        detail: `From ${fmtTokens(Math.round(growth.first / 4))} to ${fmtTokens(Math.round(growth.last / 4))} tokens (approx.) as tool results piled up. Truncating large tool outputs keeps later loops cheap.`,
      });
    }
  }

  // Busiest turn and slowest call.
  const turnTimes = cockpit.turns.map((t) => ({ t, ms: t.invocations.reduce((s, i) => s + i.durationMs, 0) }));
  const busiest = turnTimes.sort((x, y) => y.ms - x.ms)[0];
  if (busiest && cockpit.turns.length > 1 && busiest.ms > 0) {
    out.push({
      id: 'busiest',
      kind: 'info',
      icon: 'timer',
      title: `Turn ${busiest.t.turnIndex} did the most work`,
      detail: `${plural(busiest.t.toolCallCount, 'call')}, ${fmtMs(busiest.ms)} in tools (${pct(busiest.ms, a.totalToolDurationMs)} of the run).`,
      calls: busiest.t.invocations,
    });
  }
  const slowest = calls.reduce<InvocationRow | null>((m, c) => (!m || c.durationMs > m.durationMs ? c : m), null);
  if (slowest && slowest.durationMs > 0 && calls.length > 1) {
    out.push({
      id: 'slowest',
      kind: slowest.durationMs > 10_000 ? 'warn' : 'info',
      icon: 'timer',
      title: `Slowest call: ${slowest.toolName} (${fmtMs(slowest.durationMs)})`,
      detail: `In turn ${slowest.turnIndex || '—'}, ${(slowest.durationMs / (a.avgToolDurationMs || 1)).toFixed(1)}× the average call.`,
      calls: [slowest],
    });
  }

  return out;
}
