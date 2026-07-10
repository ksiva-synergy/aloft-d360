export interface AgentStat {
  sheet_id: string;
  total_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_tokens: number;
  avg_retries: number;
  validation_rate: number;
  trend: number;
}

export interface SheetBreakdown {
  sheet_type: string;
  total: number;
  success_rate: number;
}

export type RunSource = 'pipeline' | 'lab_single' | 'lab_graph' | 'compiled_pipeline' | 'inspector' | 'workbench' | 'boost';

export interface ModelStat {
  model_name: string;
  provider: string;
  total_pulls: number;
  success_rate: number;
  avg_duration_ms: number;
  alpha: number;
  beta: number;
  phase: 'exploring' | 'exploiting';
  source_counts?: Record<string, number>;
  avg_quality_score?: number | null;
  sheet_breakdown: SheetBreakdown[];
}

/** CTSGV model stat from bandit_observations. */
export interface CtsgvModelStat {
  model_id: string;
  provider: string;
  total_pulls: number;
  success_rate: number;
  avg_duration_ms: number;
  alpha: number;
  beta: number;
  phase: 'exploring' | 'exploiting';
  avg_composite: number | null;
  avg_c: number | null;
  avg_t: number | null;
  avg_s: number | null;
  avg_g: number | null;
  avg_v: number | null;
  sg_coverage: number;
  source_counts?: Record<string, number>;
  sheet_breakdown: SheetBreakdown[];
  // Compat alias for components that use model_name
  model_name?: string;
  avg_quality_score?: number | null;
  // BORN Phase 2 — posterior & Thompson sampling fields
  born_prob?: number;
  next_draw_prob?: number;
  ci_low?: number;
  ci_high?: number;
  posterior_alpha?: number;
  posterior_beta?: number;
}

export interface RecentRun {
  id: string;
  job_id: string | null;
  agent_id: string;
  sheet_id: string;
  status: string;
  total_tokens: number | null;
  total_duration_ms: number;
  output_row_count: number | null;
  validation_passed: boolean | null;
  retry_count: number;
  created_at: string;
  source: RunSource | string;
  quality_score?: number | null;
  // BORN Phase 5 — enriched fields from bandit_observations
  model_id?: string;
  sheet_type?: string;
  composite_score?: number | null;
  score_c?: number | null;
  score_t?: number | null;
  score_s?: number | null;
  score_g?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  groundedness_mode?: string | null;  // 'phantom_trace' | 'consistency_check' | null
  outcome?: string | null;
  sg_scored?: boolean;
}

export interface CostPoint {
  date: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model?: string;
}

export interface BanditsData {
  agentStats: AgentStat[];
  modelStats: ModelStat[];
  ctsgvModelStats?: CtsgvModelStat[];
  recentRuns: RecentRun[];
  costSeries: CostPoint[];
  allocationSeries: Record<string, any>[];
  allModels: string[];
  totalTraces: number;
  totalModelPulls: number;
  totalObservations?: number;
  window: number;
  // BORN Phase 2 — top-level Thompson sampling fields
  born_probs?: number[];
  belief_entropy?: number;
  favourite_model?: string;
  favourite_prob?: number;
  exploration_pct?: number;
}

export const MODEL_COLORS: Record<string, string> = {
  // Azure AI Foundry
  'gpt-5.4-PBC':        '#7c3aed',
  'o3-pro-PBC':         '#2563eb',
  'grok-4.3-PBC':       '#b91c1c',
  'kimi-k2-6-PBC':      '#0e7490',
  'DeepSeek-V4-Pro':    '#15803d',
  // Bedrock
  'us.anthropic.claude-sonnet-4-6': '#059669',
  'us.anthropic.claude-opus-4-6-v1': '#d97706',
};

/** @deprecated Use MODEL_SHORT_NAMES from '@/lib/bandits/born-tokens' instead.
 *  This copy is retained for the legacy ArmLeaderboard / BetaDistributionViz / AllocationTimeline
 *  sub-components until they are retired in Phase 4. */
export const MODEL_SHORT_NAMES: Record<string, string> = {
  // Azure AI Foundry
  'gpt-5.4-PBC':        'GPT-5.4',
  'o3-pro-PBC':         'o3-pro',
  'grok-4.3-PBC':       'Grok 4.3',
  'kimi-k2-6-PBC':      'Kimi K2.6',
  'DeepSeek-V4-Pro':    'DeepSeek V4',
  // Bedrock
  'us.anthropic.claude-sonnet-4-6': 'Sonnet 4.6',
  'us.anthropic.claude-opus-4-6-v1': 'Opus 4.6',
};

export const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  azure: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' },
  bedrock: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-800' },
};

export const SOURCE_LABELS: Record<RunSource, string> = {
  pipeline: 'Pipeline',
  lab_single: 'Lab (Single)',
  lab_graph: 'Lab (Graph)',
  compiled_pipeline: 'Compiled Pipeline',
  inspector: 'Inspector',
  workbench: 'Workbench',
  boost: 'Boost',
};

export const SOURCE_COLORS: Record<RunSource, { bg: string; text: string; border: string }> = {
  pipeline: { bg: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-200 dark:border-sky-800' },
  lab_single: { bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/30', text: 'text-fuchsia-700 dark:text-fuchsia-300', border: 'border-fuchsia-200 dark:border-fuchsia-800' },
  lab_graph: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-800' },
  compiled_pipeline: { bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-300', border: 'border-violet-200 dark:border-violet-800' },
  inspector: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' },
  workbench: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' },
  boost: { bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800' },
};

export function getModelColor(model: string): string {
  return MODEL_COLORS[model] || '#6366f1';
}

/** @deprecated Use shortName() from '@/lib/bandits/born-tokens' instead. */
export function getModelShortName(model: string): string {
  return MODEL_SHORT_NAMES[model] || model.split('/').pop()?.split('.').pop() || model;
}

export function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
