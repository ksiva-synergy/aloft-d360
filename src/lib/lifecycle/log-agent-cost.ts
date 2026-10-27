import { prisma } from '@/lib/db';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4':    { input: 15 / 1_000_000,  output: 75 / 1_000_000 },
  'claude-sonnet-4':  { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  'claude-haiku-3.5': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
  'gpt-4o':           { input: 5 / 1_000_000,   output: 15 / 1_000_000 },
  'gpt-4o-mini':      { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  // Azure AI Foundry new deployments
  'gpt-5.4':          { input: 5 / 1_000_000,   output: 15 / 1_000_000 },
  'gpt-6-luna':              { input: 0.125 / 1_000_000, output: 0.50 / 1_000_000 },
  'openai.gpt-6-luna':         { input: 0.125 / 1_000_000, output: 0.50 / 1_000_000 },
  'global.openai.gpt-6-luna':  { input: 0.125 / 1_000_000, output: 0.50 / 1_000_000 },
  'grok-4.3':         { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  'grok-4.7':         { input: 3 / 1_000_000,   output: 15 / 1_000_000 },
  'kimi-k2':          { input: 2 / 1_000_000,   output: 10 / 1_000_000 },
  'deepseek-v4':      { input: 2 / 1_000_000,   output: 6 / 1_000_000 },
  'o3-pro':           { input: 60 / 1_000_000,  output: 240 / 1_000_000 },
  'o3-mini':          { input: 1 / 1_000_000,   output: 4 / 1_000_000 },
};

/**
 * Prompt-cache price as a fraction of the normal input price, by provider family.
 * Cache reads are discounted; Anthropic also bills cache *writes* at a premium.
 * Approximate list-price ratios — adjust here if a provider changes them.
 */
function cacheRates(normalizedModel: string): { read: number; write: number } {
  if (normalizedModel.startsWith('claude')) return { read: 0.1, write: 1.25 };
  if (normalizedModel.startsWith('grok')) return { read: 0.25, write: 1 };
  if (normalizedModel.startsWith('deepseek')) return { read: 0.1, write: 1 };
  return { read: 0.5, write: 1 }; // OpenAI-style automatic caching
}

export interface CacheUsage {
  /** Input tokens served from the prompt cache (subset of inputTokens). */
  readTokens?: number;
  /** Input tokens written to the cache (subset of inputTokens; Anthropic/Bedrock only). */
  writeTokens?: number;
}

/**
 * @param inputTokens total input tokens for the call, INCLUDING cached ones
 * @param cache       how many of those were cache reads / writes
 */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number, cache: CacheUsage = {}): number {
  const normalizedModel = model.replace(/^us\.anthropic\./, '').replace(/-\d+-v\d+$/, '').replace(/-\d{8}$/, '');
  const pricing = MODEL_PRICING[normalizedModel] || MODEL_PRICING['claude-sonnet-4'];
  const rates = cacheRates(normalizedModel);
  const read = Math.max(0, cache.readTokens ?? 0);
  const write = Math.max(0, cache.writeTokens ?? 0);
  const fresh = Math.max(0, inputTokens - read - write);
  return (
    fresh * pricing.input +
    read * pricing.input * rates.read +
    write * pricing.input * rates.write +
    outputTokens * pricing.output
  );
}

export interface CostLogEntry {
  agentName: string;
  agentVersion: string;
  pipelineId?: string;
  runId?: string;
  vesselName?: string;
  /** Total input tokens, including any served from / written to the prompt cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolCalls?: number;
  model: string;
  durationMs?: number;
  status?: 'success' | 'failed';
}

export async function logAgentCost(entry: CostLogEntry): Promise<void> {
  const costUsd = computeCostUsd(entry.model, entry.inputTokens, entry.outputTokens, {
    readTokens: entry.cacheReadTokens,
    writeTokens: entry.cacheWriteTokens,
  });

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
