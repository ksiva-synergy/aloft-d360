import 'server-only';

import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';
import {
  buildTemplateSessionSummary,
  summarizeTrajectoryOutline,
  validateNarrativeAgainstFacts,
  type InspectorSessionKnowledge,
} from '@/lib/inspector/session-knowledge-core';

const DEFAULT_SUMMARY_MODEL =
  process.env.INSPECTOR_SESSION_SUMMARY_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';

function isLlmSummaryEnabled(): boolean {
  const flag = process.env.INSPECTOR_SESSION_SUMMARY_LLM;
  if (flag === 'false' || flag === '0') return false;
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function factsPayload(k: InspectorSessionKnowledge): string {
  return JSON.stringify(
    {
      task: k.task,
      entities: k.entities,
      schemaPaths: k.schemaPaths.slice(0, 24),
      heuristics: k.heuristics.slice(0, 8),
      templateSummary: buildTemplateSessionSummary(k),
    },
    null,
    0,
  );
}

export async function generateNarrativeSessionSummary(
  knowledge: InspectorSessionKnowledge,
  trajectory: TrajectoryEntry[],
  meta: { userMessage?: string; assistantExcerpt?: string },
): Promise<string | null> {
  if (!isLlmSummaryEnabled()) return null;
  if (knowledge.schemaPaths.length === 0 && knowledge.entities.length === 0) return null;

  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const region = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const client = new BedrockRuntimeClient({ region });

  const turnOutline = summarizeTrajectoryOutline(trajectory);
  const userLine = meta.userMessage ? `Latest user message: ${meta.userMessage.slice(0, 300)}` : '';
  const assistantLine = meta.assistantExcerpt
    ? `Latest assistant reply (excerpt): ${meta.assistantExcerpt.slice(0, 400)}`
    : '';

  const prompt = `You write a SHORT session recap for a data analyst agent (2–4 sentences, plain English).

STRICT RULES:
- Use ONLY facts present in CONFIRMED_FACTS_JSON. Do not invent table paths, vessel names, or IDs.
- Say what is confirmed vs what remains (e.g. final extract SQL still pending).
- No markdown, no bullet lists, no tool narration ("I will query…").

CONFIRMED_FACTS_JSON:
${factsPayload(knowledge)}

THIS_TURN_TOOLS:
${turnOutline || '(none)'}

${userLine}
${assistantLine}

Session recap:`;

  try {
    const response = await client.send(
      new ConverseCommand({
        modelId: DEFAULT_SUMMARY_MODEL,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 220, temperature: 0 },
      }),
    );

    const text =
      (response.output?.message?.content?.[0] as { text?: string } | undefined)?.text?.trim() ?? '';
    if (!text || text.length < 20) return null;
    if (!validateNarrativeAgainstFacts(text, knowledge)) {
      console.warn('[session-knowledge-llm] narrative rejected (paths not in facts)');
      return null;
    }
    return text.slice(0, 1200);
  } catch (err) {
    console.warn(
      '[session-knowledge-llm] narrative generation failed (non-fatal):',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
