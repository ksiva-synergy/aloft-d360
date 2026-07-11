import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

const SCORER_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

function getClient() {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export type GroundednessMode = 'phantom_trace' | 'consistency_check';

export interface GroundednessResult {
  score: number;
  detail: unknown;
}

const PHANTOM_TRACE_PROMPT = `You are a fact-checking auditor. Given an agent's answer and the raw tool results it received, identify the TOP 20 most significant quantitative claims (numbers, percentages, counts, rankings) in the answer. Do not enumerate every number — focus on the headline statistics that a fact-checker would care about. For each claim, determine whether it is SUPPORTED (traceable to a specific tool result), UNSUPPORTED (not found in any tool result), or FABRICATED (contradicts a tool result).

Respond ONLY with JSON:
{
  "claims": [
    { "claim": "India represents 77.8% of movements", "verdict": "supported", "evidence": "tool_result_3 row showing India count / total" }
  ],
  "supported": <count>,
  "unsupported": <count>,
  "fabricated": <count>,
  "score": <supported / total, 0.0-1.0>
}`;

const CONSISTENCY_CHECK_PROMPT = `You are a consistency auditor. Given an agent's advisory answer and the raw tool results it received, check for:
1. FABRICATED ENTITIES — table names, column names, vessel names, or data values mentioned in the answer that do not appear in any tool result
2. CONTRADICTIONS — conclusions that contradict the data shown in tool results
3. UNSUPPORTED CAUSAL CLAIMS — cause-effect statements with no data backing

Respond ONLY with JSON:
{
  "issues": [
    { "type": "fabricated_entity", "detail": "mentions column CREW_RATING which does not appear in any tool result", "severity": "high" }
  ],
  "issue_count": <count>,
  "score": <1.0 - (high_issues * 0.2 + medium_issues * 0.1 + low_issues * 0.05), floor 0.0>
}`;

function extractJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return JSON.parse(text.slice(braceStart, braceEnd + 1));
  }
  return JSON.parse(text);
}

export async function scoreGroundedness(params: {
  answerExcerpt: string | null;
  answerFull?: string | null;
  toolTrajectory: unknown[];
  mode: GroundednessMode;
}): Promise<GroundednessResult | null> {
  const { answerExcerpt, answerFull, toolTrajectory, mode } = params;

  const answerText = answerFull || answerExcerpt;
  if (!answerText || answerText.trim().length === 0) {
    return null;
  }

  try {
    const client = getClient();

    const systemPrompt = mode === 'phantom_trace' ? PHANTOM_TRACE_PROMPT : CONSISTENCY_CHECK_PROMPT;

    const trajectoryStr = JSON.stringify(toolTrajectory, null, 1).slice(0, 40000);

    const userMessage = `AGENT'S ANSWER:\n${answerText}\n\nTOOL RESULTS (trajectory):\n${trajectoryStr}`;

    const command = new ConverseCommand({
      modelId: SCORER_MODEL_ID,
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: userMessage }] }],
      inferenceConfig: { maxTokens: 8192, temperature: 0 },
    });

    const response = await client.send(command);
    const outputText = response.output?.message?.content?.[0]?.text ?? '';

    const parsed = extractJson(outputText) as Record<string, unknown>;
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : null;

    if (score === null) return null;

    return { score, detail: parsed };
  } catch (err) {
    console.error('[groundedness scorer] LLM call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
