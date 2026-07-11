import { prisma } from '@/lib/db';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4':    { input: 15 / 1_000_000,  output: 75 / 1_000_000 },
  'claude-sonnet-4':  { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  'claude-haiku-3.5': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  'gpt-4o':           { input: 5 / 1_000_000,   output: 15 / 1_000_000 },
  'gpt-4o-mini':      { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  // Azure AI Foundry new deployments
  'gpt-5.4':          { input: 5 / 1_000_000,   output: 15 / 1_000_000 },
  'grok-4.3':         { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  'kimi-k2':          { input: 2 / 1_000_000,   output: 10 / 1_000_000 },
  'deepseek-v4':      { input: 2 / 1_000_000,   output: 6 / 1_000_000 },
  'o3-pro':           { input: 60 / 1_000_000,  output: 240 / 1_000_000 },
  'o3-mini':          { input: 1 / 1_000_000,   output: 4 / 1_000_000 },
};

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const normalizedModel = model.replace(/^us\.anthropic\./, '').replace(/-\d+-v\d+$/, '').replace(/-\d{8}$/, '');
  const pricing = MODEL_PRICING[normalizedModel] || MODEL_PRICING['claude-sonnet-4'];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

export interface CostLogEntry {
  agentName: string;
  agentVersion: string;
  pipelineId?: string;
  runId?: string;
  vesselName?: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls?: number;
  model: string;
  durationMs?: number;
  status?: 'success' | 'failed';
}

export async function logAgentCost(entry: CostLogEntry): Promise<void> {
  const costUsd = computeCostUsd(entry.model, entry.inputTokens, entry.outputTokens);

  try {
    await prisma.agent_cost_log.create({
      data: {
        agent_name: entry.agentName,
        agent_version: entry.agentVersion,
        pipeline_id: entry.pipelineId || null,
        run_id: entry.runId || null,
        vessel_name: entry.vesselName || null,
        input_tokens: entry.inputTokens,
        output_tokens: entry.outputTokens,
        tool_calls: entry.toolCalls || 0,
        cost_usd: costUsd,
        model: entry.model,
        duration_ms: entry.durationMs || null,
        status: entry.status || 'success',
      },
    });
  } catch (err) {
    console.error('[lifecycle/log-agent-cost] insert failed:', err);
  }
}
