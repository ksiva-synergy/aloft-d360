import type { BoostCase } from '@/lib/boost/suite';
import { callScorerLlm } from '@/lib/boost/scorers/llm-client';

export interface SemanticDimensions {
  completeness: { score: number; rationale: string };
  scope_fit: { score: number; rationale: string };
  analytical_depth: { score: number; rationale: string };
  structure: { score: number; rationale: string };
}

export interface SemanticResult {
  composite: number;
  dimensions: SemanticDimensions;
  summary: string;
}

function buildRubricPrompt(boostCase: BoostCase, answerExcerpt: string): string {
  return `You are evaluating an AI agent's answer to a data analysis task.

TASK: ${boostCase.title}
PROMPT: ${boostCase.prompt}
EXPECTED DIMENSIONS: ${boostCase.expectedDimensions.join(', ')}

AGENT'S ANSWER (may be truncated to first 2000 chars):
${answerExcerpt.slice(0, 2000)}

Score each dimension 0.0-1.0 with a one-line rationale:

1. COMPLETENESS — Does the answer address all expected dimensions? A 1.7k-token answer to a multi-table enrichment that should cover 4+ dimensions scores low if it only superficially touches one or two. A comprehensive synthesis covering all dimensions with supporting data scores high.
2. SCOPE_FIT — Does the answer stay within what was asked, without hallucinating extra structure or inventing data not retrieved by the tools?
3. ANALYTICAL_DEPTH — Does the answer show genuine analytical reasoning (trends, risks, comparisons, actionable insights) or just dump raw query results?
4. STRUCTURE — Is the answer well-organized, with clear sections and readable formatting?

Respond ONLY with JSON:
{
  "dimensions": {
    "completeness": { "score": 0.0, "rationale": "..." },
    "scope_fit": { "score": 0.0, "rationale": "..." },
    "analytical_depth": { "score": 0.0, "rationale": "..." },
    "structure": { "score": 0.0, "rationale": "..." }
  },
  "composite": 0.0,
  "summary": "one-sentence overall assessment"
}`;
}

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

export async function scoreSemanticQuality(params: {
  answerExcerpt: string | null;
  answerFull?: string | null;
  boostCase: BoostCase;
  toolTrajectory: unknown[];
}): Promise<SemanticResult | null> {
  const { answerExcerpt, answerFull, boostCase } = params;

  const answerText = answerFull || answerExcerpt;
  if (!answerText || answerText.trim().length === 0) {
    return null;
  }

  try {
    const outputText = await callScorerLlm({
      system: 'You are an evaluation judge. Return only valid JSON.',
      user: buildRubricPrompt(boostCase, answerText),
      maxTokens: 4096,
    });

    const parsed = extractJson(outputText) as {
      dimensions?: SemanticDimensions;
      composite?: number;
      summary?: string;
    };

    if (!parsed.dimensions) return null;

    const dims = parsed.dimensions;
    const scores = [
      dims.completeness?.score,
      dims.scope_fit?.score,
      dims.analytical_depth?.score,
      dims.structure?.score,
    ].filter((s): s is number => typeof s === 'number');

    const composite = scores.length > 0
      ? Math.max(0, Math.min(1, scores.reduce((a, b) => a + b, 0) / scores.length))
      : null;

    if (composite === null) return null;

    return {
      composite,
      dimensions: dims,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch (err) {
    console.error('[semantic scorer] LLM call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
