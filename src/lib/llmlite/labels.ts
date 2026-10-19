const GATEWAY_LABELS: Record<string, string> = {
  'aws_bedrock/Gpt-6-Luna': 'GPT-6 Luna (LLM Lite)',
  'aws_bedrock/Claude-Sonnet-5': 'Claude Sonnet 5 (LLM Lite)',
  'aws_bedrock/Claude-Haiku-4.5': 'Claude Haiku 4.5 (LLM Lite)',
  'aws_bedrock/Claude-Haiku-5.5': 'Claude Haiku 5.5 (LLM Lite)',
  'aws_bedrock/xAI-Grok-4.7': 'Grok 4.7 (LLM Lite)',
  'aws_bedrock/Nova2-lite-v1': 'Nova 2 Lite (LLM Lite)',
  'azure_ai/gpt-5.6-luna': 'GPT-5.6 Luna (LLM Lite)',
  'azure_ai/gpt-5.6-terra': 'GPT-5.6 Terra (LLM Lite)',
  'azure_ai/gpt-5.4-mini': 'GPT-5.4 Mini (LLM Lite)',
  'azure_ai/grok-4.6': 'Grok 4.6 (LLM Lite)',
};

export function labelForGatewayModelId(gatewayModelId: string): string {
  if (GATEWAY_LABELS[gatewayModelId]) return GATEWAY_LABELS[gatewayModelId];
  const tail = gatewayModelId.includes('/')
    ? gatewayModelId.split('/').pop()!
    : gatewayModelId;
  const pretty = tail.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${pretty} (LLM Lite)`;
}
