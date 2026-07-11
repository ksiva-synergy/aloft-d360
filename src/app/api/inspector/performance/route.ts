import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AVAILABLE_MODELS } from "@/components/agent-lab/workbench/types";

export const dynamic = "force-dynamic";

// Aggregate inspector session stats grouped by model + context_mode
// Reads from agent_cost_log (one row per chat response, agentName = InspectorChat)
// Joins via run_id -> workbench_sessions.id to get context_mode
export async function GET() {
  try {
    const rows = await prisma.agent_cost_log.findMany({
      where: { agent_name: "InspectorChat" },
      select: {
        id: true,
        model: true,
        input_tokens: true,
        output_tokens: true,
        tool_calls: true,
        duration_ms: true,
        run_id: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 2000,
    });

    // Pull context_mode from workbench_sessions, keyed by session id
    const sessions = await prisma.workbench_sessions.findMany({
      where: { surface: "inspector" },
      select: { id: true, context_mode: true },
    });

    const sessionModeMap = new Map<string, string>(
      sessions.map(s => [s.id, s.context_mode ?? "harvested"])
    );

    // Build model-key lookup from Bedrock ID
    const bedrockToKey = new Map(
      AVAILABLE_MODELS.map(m => [m.bedrockId, m.key])
    );

    type Acc = {
      sessions: Set<string>;
      tokenSums: number[];
      latencySums: number[];
      loopSums: number[];
      warehouseSums: number[];
      modelLabel: string;
      contextMode: string;
      modelKey: string;
    };

    const grouped = new Map<string, Acc>();

    for (const row of rows) {
      if (!row.model) continue;
      const modelKey = bedrockToKey.get(row.model) ?? row.model;
      const modelLabel = AVAILABLE_MODELS.find(m => m.key === modelKey)?.label ?? modelKey;
      // Resolve context_mode: join via run_id -> workbench_sessions
      const ctxMode = row.run_id && sessionModeMap.has(row.run_id)
        ? sessionModeMap.get(row.run_id)!
        : "harvested";
      const gk = `${modelKey}::${ctxMode}`;
      if (!grouped.has(gk)) {
        grouped.set(gk, {
          sessions: new Set(),
          tokenSums: [],
          latencySums: [],
          loopSums: [],
          warehouseSums: [],
          modelLabel,
          contextMode: ctxMode,
          modelKey,
        });
      }
      const g = grouped.get(gk)!;
      if (row.run_id) g.sessions.add(row.run_id);
      const total = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      g.tokenSums.push(total);
      if (row.duration_ms) g.latencySums.push(row.duration_ms);
      g.loopSums.push(row.tool_calls ?? 0);
      g.warehouseSums.push(row.tool_calls ?? 0);
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const stats = Array.from(grouped.values()).map(g => ({
      modelKey: g.modelKey,
      modelLabel: g.modelLabel,
      contextMode: g.contextMode,
      sessions: g.sessions.size || g.tokenSums.length,
      avgTokens: Math.round(avg(g.tokenSums)),
      avgLatencyMs: Math.round(avg(g.latencySums)),
      avgLoops: Math.round(avg(g.loopSums) * 10) / 10,
      avgWarehouseCalls: Math.round(avg(g.warehouseSums) * 10) / 10,
    }));

    return NextResponse.json({ stats });
  } catch (err) {
    console.error("[inspector/performance]", err);
    return NextResponse.json({ stats: [] });
  }
}
