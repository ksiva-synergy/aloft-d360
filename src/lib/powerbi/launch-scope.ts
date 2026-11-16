/** Power BI job scope fields stored on `platform_context_jobs.scope` (orchestrator). */

export type PbiJobLaunchScope = {
  model_ids?: string[];
  report_ids?: string[];
  fetch_models?: boolean;
  fetch_reports?: boolean;
  force_parse?: boolean;
  /** Recreation runs: oracle reads translated measures (parity ground truth). */
  oracle_only_translated?: boolean;
  llm_translate?: boolean;
  max_llm_measures?: number;
  force_translate?: boolean;
};

export function pbiJobScopeFromLaunchBody(body: Record<string, unknown>): PbiJobLaunchScope {
  const out: PbiJobLaunchScope = {};
  const modelIds = body.modelIds ?? body.model_ids;
  const reportIds = body.reportIds ?? body.report_ids;
  if (Array.isArray(modelIds) && modelIds.length > 0) {
    out.model_ids = modelIds.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (Array.isArray(reportIds) && reportIds.length > 0) {
    out.report_ids = reportIds.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (body.pbiFetchModels === false) out.fetch_models = false;
  if (body.pbiFetchReports === false) out.fetch_reports = false;
  if (body.forceParse === true || body.force_parse === true) out.force_parse = true;
  if (body.oracleOnlyTranslated === true) out.oracle_only_translated = true;
  if (typeof body.llmTranslate === 'boolean') out.llm_translate = body.llmTranslate;
  if (typeof body.maxLlmMeasures === 'number' && body.maxLlmMeasures >= 0) out.max_llm_measures = body.maxLlmMeasures;
  if (body.forceTranslate === true) out.force_translate = true;
  return out;
}

export function mergeJobScope(base: Record<string, unknown>, pbi: PbiJobLaunchScope): Record<string, unknown> {
  if (Object.keys(pbi).length === 0) return base;
  return { ...base, ...pbi };
}