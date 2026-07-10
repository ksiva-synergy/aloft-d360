import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// Titan v2 embeddings are only available in us-east-1 via Bedrock
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMS = 1024;

/**
 * Embed a string using Amazon Titan Embed Text v2 (1024 dimensions).
 * Truncates to ~32 000 chars (~8 192 tokens) before sending.
 * Never throws — returns null on any Bedrock failure so callers can
 * store chunks without embeddings and degrade gracefully.
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const truncated = text.slice(0, 32_000);
    const payload = {
      inputText: truncated,
      dimensions: EMBEDDING_DIMS,
      normalize: true,
    };

    const command = new InvokeModelCommand({
      modelId: EMBEDDING_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body)) as {
      embedding: number[];
    };
    return result.embedding;
  } catch (err) {
    console.warn('[embed] Bedrock call failed — storing chunk without embedding', err);
    return null;
  }
}

/**
 * Formats a number[] as a pgvector literal string: '[0.1,0.2,...]'
 */
export function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
