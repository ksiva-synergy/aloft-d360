import { z } from 'zod';

import {
  type HarvestLlmCallOverrides,
  type HarvestLlmProvider,
  getHarvestLlmCostPerMillion,
  getHarvestLlmModelIdForProvider,
  getHarvestLlmProvider,
  harvestLlmComplete,
} from '@/lib/context/harvest-llm';
import { isLlmLiteConfigured } from '@/lib/llmlite/config';
import { extractJsonObject, validateLlmSql } from '@/lib/powerbi/translate-llm-validate';

export const PBI_TRANSLATE_LLM_PROMPT_VERSION = 'pbi-dax-sql-v2-catalog';

const LlmTranslateSchema = z.object({
  sql: z.string(),
  grain: z.string().nullish(),
  assumptions: z.string().nullish(),
  explanation: z.string().nullish(),
});

const SYSTEM_PROMPT = `You translate Power BI DAX measures into Databricks SQL.
Output strict JSON only (no markdown): {"sql":"...","grain":"...","assumptions":"...","explanation":"..."}.
Rules:
- sql must be a single SELECT that returns one scalar numeric value (alias value).
- Use the provided Unity Catalog three-part table path in FROM; quote identifiers with backticks.
- Use only warehouse column names listed in allowed_columns or column_map values.
- Do not invent tables or columns not in the provided catalog context.
- Prefer simple, readable SQL over clever shortcuts.
- If the DAX cannot be faithfully translated, return {"sql":"","grain":null,"assumptions":"cannot_translate","explanation":"..."} with empty sql.
- Keep assumptions and explanation under 200 characters each so the JSON fits in one response.`;

/** Prefer direct xAI Grok when `XAI_API_KEY` is set (avoids LLM Lite → Bedrock Grok quirks). */
export function getPbiTranslateLlmRouting(): HarvestLlmCallOverrides {
  const explicit = process.env.PBI_TRANSLATE_LLM_PROVIDER?.trim().toLowerCase();
  let provider: HarvestLlmProvider;
  if (
    explicit === 'llmlite' ||
    explicit === 'xai' ||
    explicit === 'bedrock' ||
    explicit === 'groq'
  ) {
    provider = explicit;
  } else if (process.env.XAI_API_KEY?.trim()) {
    provider = 'xai';
  } else {
    provider = getHarvestLlmProvider();
  }

  const modelOverride = process.env.PBI_TRANSLATE_LLM_MODEL?.trim();
  if (modelOverride) {
    return { provider, modelId: modelOverride };
  }
  if (provider === 'xai') {
    const xaiModel =
      process.env.PBI_TRANSLATE_XAI_MODEL?.trim() ||
      process.env.XAI_MODEL?.trim() ||
      getHarvestLlmModelIdForProvider('xai');
    return { provider, modelId: xaiModel };
  }
  return { provider, modelId: getHarvestLlmModelIdForProvider(provider) };
}

function getPbiTranslateLlmFallbackRouting(
  primary: HarvestLlmCallOverrides,
): HarvestLlmCallOverrides | null {
  const fallbackModel = process.env.PBI_TRANSLATE_LLM_FALLBACK_MODEL?.trim();
  if (fallbackModel) {
    return { provider: 'llmlite', modelId: fallbackModel };
  }
  if (primary.provider === 'xai' && isLlmLiteConfigured()) {
    const sonnet =
      process.env.PBI_TRANSLATE_LLM_FALLBACK_MODEL?.trim() ||
      process.env.BEDROCK_SONNET_MODEL_ID?.trim() ||
      'aws_bedrock/us.anthropic.claude-sonnet-4-6';
    return { provider: 'llmlite', modelId: sonnet };
  }
  return null;
}

export function isPbiTranslateLlmAvailable(): boolean {
  if (process.env.PBI_TRANSLATE_LLM === '0' || process.env.PBI_TRANSLATE_LLM === 'false') {
    return false;
  }
  if (isLlmLiteConfigured()) return true;
  if (process.env.XAI_API_KEY?.trim()) return true;
  if (process.env.GROQ_API_KEY?.trim()) return true;
  if (process.env.HARVEST_LLM_PROVIDER?.trim().toLowerCase() === 'bedrock') return true;
  return false;
}

export type LlmTranslateMeasureInput = {
  modelName: string;
  tableName: string;
  measureName: string;
  dax: string;
  ucFullPath: string;
  nativeSql?: string | null;
  allowedColumns?: string[];
  columnMap?: Record<string, string>;
};

export type LlmTranslateMeasureResult = {
  sql: string;
  grain?: string;
  assumptions?: string;
  explanation?: string;
  modelId: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
};

export async function translateMeasureWithLlm(
  input: LlmTranslateMeasureInput,
): Promise<LlmTranslateMeasureResult | null> {
  const dax = input.dax.slice(0, 12_000);
  const userMessage = JSON.stringify(
    {
      model: input.modelName,
      table: input.tableName,
      measure: input.measureName,
      uc_full_path: input.ucFullPath,
      native_sql_for_table: input.nativeSql?.slice(0, 4000) ?? null,
      allowed_columns: input.allowedColumns?.slice(0, 200) ?? [],
      column_map: input.columnMap ?? {},
      dax,
    },
    null,
    2,
  );

  const maxTokens =
    Number(process.env.PBI_TRANSLATE_LLM_MAX_TOKENS ?? '4096') || 4096;

  const primary = getPbiTranslateLlmRouting();
  const llmParams = {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userMessage }],
    maxTokens,
    temperature: 0.1,
  };

  let resp: Awaited<ReturnType<typeof harvestLlmComplete>>;
  let modelId = primary.modelId ?? getHarvestLlmModelIdForProvider(primary.provider!);
  try {
    console.log(
      `[pbi_translate] llm measure=${input.measureName} provider=${primary.provider} model=${modelId}`,
    );
    resp = await harvestLlmComplete(llmParams, primary);
  } catch (err) {
    const fallback = getPbiTranslateLlmFallbackRouting(primary);
    if (!fallback) throw err;
    console.warn(
      `[pbi_translate] llm primary failed measure=${input.measureName}, fallback provider=${fallback.provider} model=${fallback.modelId}:`,
      err instanceof Error ? err.message : err,
    );
    resp = await harvestLlmComplete(llmParams, fallback);
    modelId = fallback.modelId ?? modelId;
  }

  let parsed: z.infer<typeof LlmTranslateSchema>;
  try {
    parsed = LlmTranslateSchema.parse(JSON.parse(extractJsonObject(resp.text)));
  } catch (err) {
    const fallback = getPbiTranslateLlmFallbackRouting(primary);
    if (fallback) {
      try {
        console.warn(
          `[pbi_translate] llm JSON retry with fallback measure=${input.measureName} model=${fallback.modelId}`,
        );
        resp = await harvestLlmComplete(llmParams, fallback);
        modelId = fallback.modelId ?? modelId;
        parsed = LlmTranslateSchema.parse(JSON.parse(extractJsonObject(resp.text)));
      } catch {
        console.warn(
          `[pbi_translate] llm JSON parse failed measure=${input.measureName}:`,
          err instanceof Error ? err.message : err,
          `raw_len=${resp.text.length}`,
        );
        return null;
      }
    } else {
      console.warn(
        `[pbi_translate] llm JSON parse failed measure=${input.measureName}:`,
        err instanceof Error ? err.message : err,
        `raw_len=${resp.text.length}`,
      );
      return null;
    }
  }

  let sql = validateLlmSql(parsed.sql);
  if (!sql) {
    const fallback = getPbiTranslateLlmFallbackRouting(primary);
    if (fallback) {
      try {
        console.warn(
          `[pbi_translate] llm empty/invalid sql on primary, fallback measure=${input.measureName} model=${fallback.modelId}`,
        );
        resp = await harvestLlmComplete(llmParams, fallback);
        modelId = fallback.modelId ?? modelId;
        parsed = LlmTranslateSchema.parse(JSON.parse(extractJsonObject(resp.text)));
        sql = validateLlmSql(parsed.sql);
      } catch {
        /* keep null */
      }
    }
  }
  if (!sql) return null;

  return {
    sql,
    grain: parsed.grain ?? undefined,
    assumptions: parsed.assumptions ?? undefined,
    explanation: parsed.explanation ?? undefined,
    modelId,
    promptVersion: PBI_TRANSLATE_LLM_PROMPT_VERSION,
    inputTokens: resp.inputTokens,
    outputTokens: resp.outputTokens,
  };
}

export function estimateHarvestLlmCostUsd(inputTokens: number, outputTokens: number): number {
  const { input, output } = getHarvestLlmCostPerMillion();
  return (inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
}
