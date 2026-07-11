export type ModelTier = 'frontier' | 'production' | 'value' | 'cheap' | 'reasoning';
export type TokenParam = 'max_tokens' | 'max_completion_tokens';
export type FoundryResource = 'resource1' | 'resource2' | 'bedrock-mantle';

export type BoostModel = {
  key: string;
  label: string;
  provider: 'bedrock' | 'foundry';
  apiType: 'converse' | 'foundry';
  modelId: string;
  tier: ModelTier;
  resource?: FoundryResource;
  tokenParam?: TokenParam;
};

export const BOOST_MODELS: BoostModel[] = [
  // ── Bedrock Converse (5 proven models) ──────────────────────
  { key: 'opus-4-6',    label: 'Claude Opus 4.6',   provider: 'bedrock',
    apiType: 'converse', modelId: 'us.anthropic.claude-opus-4-6-v1',
    tier: 'frontier' },
  { key: 'sonnet-4-6',  label: 'Claude Sonnet 4.6', provider: 'bedrock',
    apiType: 'converse', modelId: 'us.anthropic.claude-sonnet-4-6',
    tier: 'production' },
  { key: 'mistral-l3',  label: 'Mistral Large 3',   provider: 'bedrock',
    apiType: 'converse', modelId: 'mistral.mistral-large-3-675b-instruct',
    tier: 'value' },
  { key: 'haiku-4-5',   label: 'Claude Haiku 4.5',  provider: 'bedrock',
    apiType: 'converse', modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tier: 'cheap' },
  { key: 'qwen3-32b',   label: 'Qwen3 32B',         provider: 'bedrock',
    apiType: 'converse', modelId: 'qwen.qwen3-32b-v1:0',
    tier: 'cheap' },

  // ── Azure Foundry Resource 1 (azopenai-crewai) ───────────────
  { key: 'gpt-5-4',     label: 'GPT-5.4',           provider: 'foundry',
    apiType: 'foundry',  modelId: 'gpt-5.4-PBC',
    resource: 'resource1', tokenParam: 'max_completion_tokens',
    tier: 'frontier' },

  // ── Azure Foundry Resource 2 (pb-az-openai) ──────────────────
  { key: 'grok-4-3',    label: 'Grok 4.3',          provider: 'foundry',
    apiType: 'foundry',  modelId: 'grok-4.3-PBC',
    resource: 'resource2', tokenParam: 'max_tokens',
    tier: 'frontier' },
  { key: 'kimi-k2-6',   label: 'Kimi K2.6',         provider: 'foundry',
    apiType: 'foundry',  modelId: 'kimi-k2-6-PBC',
    resource: 'resource2', tokenParam: 'max_tokens',
    tier: 'value' },
  { key: 'deepseek-v4', label: 'DeepSeek V4 Pro',   provider: 'foundry',
    apiType: 'foundry',  modelId: 'DeepSeek-V4-Pro',
    resource: 'resource2', tokenParam: 'max_tokens',
    tier: 'value' },
  { key: 'o3-mini',     label: 'o3-mini',            provider: 'foundry',
    apiType: 'foundry',  modelId: 'o3-mini',
    resource: 'resource2', tokenParam: 'max_completion_tokens',
    tier: 'reasoning' },
];
