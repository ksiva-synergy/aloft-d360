import 'server-only';

import OpenAI from 'openai';
import type { ColumnProfile } from './types';

export const INSIGHTS_PROMPT_VERSION = 'insights_v1';

export type InsightKind =
  | 'dominance'
  | 'outlier'
  | 'trend'
  | 'distribution'
  | 'data_quality'
  | 'parity';

export type InsightConfidence = 'high' | 'medium';

export interface InsightItem {
  headline: string;
  body: string;
  kind: InsightKind;
  confidence: InsightConfidence;
  columns: string[];
}

export interface InsightResult {
  insights: InsightItem[];
}

export interface GenerateStudioInsightsInput {
  sql: string;
  profiles: ColumnProfile[];
  specs: Array<{
    kind: string;
    rationale: string;
    x?: string;
    y?: string | string[];
  }>;
  sampleRows: Record<string, unknown>[];
}

export interface GenerateStudioInsightsOutput extends InsightResult {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

const VALID_KINDS = new Set<InsightKind>([
  'dominance',
  'outlier',
  'trend',
  'distribution',
  'data_quality',
  'parity',
]);

const VALID_CONFIDENCE = new Set<InsightConfidence>(['high', 'medium']);

const SYSTEM_PROMPT = `You are a data analyst writing concise insights for a SQL query result shown in a dashboard.

Rules:
- Output ONLY valid JSON matching the schema. No markdown.
- Produce 3 to 5 insights grounded in the supplied column profiles, chart specs, and sample rows.
- Do not invent columns or metrics not supported by the data.
- headline: one short sentence (max ~120 chars).
- body: 1-2 sentences explaining why it matters for a business reader.
- kind: one of dominance, outlier, trend, distribution, data_quality, parity.
- confidence: high if clearly supported by stats/samples; medium if plausible but limited evidence.
- columns: array of exact column names from the profile list that the insight references (can be empty only for data_quality).`;

/** Grok via xAI direct, else Azure AI Foundry deployment (e.g. grok-4.3-PBC). */
function insightsModelId(): string {
  if (process.env.XAI_API_KEY) {
    return process.env.STUDIO_INSIGHTS_MODEL || process.env.XAI_MODEL || 'grok-4.7';
  }
  return (
    process.env.STUDIO_INSIGHTS_MODEL ||
    process.env.STUDIO_INSIGHTS_DEPLOYMENT ||
    'grok-4.3-PBC'
  );
}

function getInsightsClient(): OpenAI {
  if (process.env.XAI_API_KEY) {
    const base = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
    return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: base });
  }

  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_API_KEY;
  if (endpoint && apiKey) {
    const base = endpoint.replace(/\/$/, '');
    return new OpenAI({
      apiKey,
      baseURL: `${base}/openai/v1`,
      defaultHeaders: { 'api-key': apiKey },
    });
  }

  throw new Error(
    'Studio insights requires XAI_API_KEY (Grok) or FOUNDRY_ENDPOINT + FOUNDRY_API_KEY',
  );
}

function buildUserPayload(input: GenerateStudioInsightsInput): string {
  const profileSummary = input.profiles.slice(0, 30).map(p => ({
    name: p.name,
    kind: p.kind,
    cardinality: p.cardinality,
    nullRate: p.nullRate,
    min: p.min,
    max: p.max,
    stats: p.stats,
    topValues: p.topValues?.slice(0, 3),
  }));

  return JSON.stringify(
    {
      sql: input.sql.slice(0, 2000),
      rowSampleCount: input.sampleRows.length,
      sampleRows: input.sampleRows.slice(0, 20),
      charts: input.specs.slice(0, 6),
      columnProfiles: profileSummary,
      responseSchema: {
        insights: [
          {
            headline: 'string',
            body: 'string',
            kind: 'dominance|outlier|trend|distribution|data_quality|parity',
            confidence: 'high|medium',
            columns: ['column_name'],
          },
        ],
      },
    },
    null,
    0,
  );
}

function normalizeInsight(raw: unknown): InsightItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const headline = typeof o.headline === 'string' ? o.headline.trim() : '';
  const body = typeof o.body === 'string' ? o.body.trim() : '';
  const kind = o.kind as InsightKind;
  const confidence = o.confidence as InsightConfidence;
  if (!headline || !body || !VALID_KINDS.has(kind) || !VALID_CONFIDENCE.has(confidence)) {
    return null;
  }
  const columns = Array.isArray(o.columns)
    ? o.columns.filter((c): c is string => typeof c === 'string').slice(0, 8)
    : [];
  return { headline, body, kind, confidence, columns };
}

function parseInsightsJson(text: string): InsightItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Model did not return JSON');
    parsed = JSON.parse(text.slice(start, end + 1));
  }

  const list =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { insights?: unknown }).insights)
      ? (parsed as { insights: unknown[] }).insights
      : Array.isArray(parsed)
        ? parsed
        : [];

  const insights = list
    .map(normalizeInsight)
    .filter((x): x is InsightItem => x !== null)
    .slice(0, 5);

  return insights;
}

export async function generateStudioInsights(
  input: GenerateStudioInsightsInput,
): Promise<GenerateStudioInsightsOutput> {
  const model = insightsModelId();
  const client = getInsightsClient();
  const started = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPayload(input) },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 2048,
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content ?? '';
  const insights = parseInsightsJson(content);

  return {
    insights,
    model,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    durationMs: Date.now() - started,
  };
}
