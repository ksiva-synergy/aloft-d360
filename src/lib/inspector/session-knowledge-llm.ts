import 'server-only';

import OpenAI from 'openai';
import type { TrajectoryEntry } from '@/lib/inspector/agent-loop';
import {
  buildTemplateSessionSummary,
  summarizeTrajectoryOutline,
  validateNarrativeAgainstFacts,
  type InspectorSessionKnowledge,
} from '@/lib/inspector/session-knowledge-core';

/** Small Foundry deployment for cheap session recaps (override via env). */
const DEFAULT_SUMMARY_MODEL = process.env.INSPECTOR_SESSION_SUMMARY_MODEL ?? 'gpt-6-luna';

const BEDROCK_FALLBACK_MODEL =
  process.env.INSPECTOR_SESSION_SUMMARY_BEDROCK_MODEL ?? 'us.amazon.nova-micro-v1:0';

function isLlmSummaryEnabled(): boolean {
  const flag = process.env.INSPECTOR_SESSION_SUMMARY_LLM;
  if (flag === 'false' || flag === '0') return false;
  return !!(
    (process.env.FOUNDRY_ENDPOINT && process.env.FOUNDRY_API_KEY) ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  );
}

function getFoundrySummaryClient(): OpenAI | null {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_API_KEY;
  if (!endpoint || !apiKey) return null;
  const base = endpoint.replace(/\/$/, '');
  return new OpenAI({
    apiKey,
    baseURL: `${base}/openai/v1`,
    defaultHeaders: { 'api-key': apiKey },
  });
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

function buildSummaryPrompt(
  knowledge: InspectorSessionKnowledge,
  trajectory: TrajectoryEntry[],
  meta: { userMessage?: string; assistantExcerpt?: string },
): string {
  const turnOutline = summarizeTrajectoryOutline(trajectory);
  const userLine = meta.userMessage ? `Latest user message: ${meta.userMessage.slice(0, 300)}` : '';
  const assistantLine = meta.assistantExcerpt
    ? `Latest assistant reply (excerpt): ${meta.assistantExcerpt.slice(0, 400)}`
    : '';

  return `You write a SHORT session recap for a data analyst agent (2–4 sentences, plain English).

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
}

async function callFoundrySummary(prompt: string): Promise<string | null> {
  const client = getFoundrySummaryClient();
  if (!client) return null;

  const response = await client.chat.completions.create({
    model: DEFAULT_SUMMARY_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You write brief, factual data-session recaps. Plain text only.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 220,
    temperature: 0,
  });

  return response.choices[0]?.message?.content?.trim() ?? null;
}

async function callBedrockSummary(prompt: string): Promise<string | null> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const region = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const client = new BedrockRuntimeClient({ region });

  const response = await client.send(
    new ConverseCommand({
      modelId: BEDROCK_FALLBACK_MODEL,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 220, temperature: 0 },
    }),
  );

  return (
    (response.output?.message?.content?.[0] as { text?: string } | undefined)?.text?.trim() ?? null
  );
}

export async function generateNarrativeSessionSummary(
  knowledge: InspectorSessionKnowledge,
  trajectory: TrajectoryEntry[],
  meta: { userMessage?: string; assistantExcerpt?: string },
): Promise<string | null> {
  if (!isLlmSummaryEnabled()) return null;
  if (knowledge.schemaPaths.length === 0 && knowledge.entities.length === 0) return null;

  const prompt = buildSummaryPrompt(knowledge, trajectory, meta);

  try {
    let text: string | null = null;
    if (getFoundrySummaryClient()) {
      text = await callFoundrySummary(prompt);
    } else {
      text = await callBedrockSummary(prompt);
    }

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
