import { randomUUID } from 'node:crypto';

/**
 * Turns a raw model/provider/exception message into a safe, user-facing
 * stream error. The raw text (which can carry provider names, endpoints,
 * request IDs or config hints) is logged server-side under a short reference
 * the user can quote to support.
 */
const CATEGORIES: ReadonlyArray<{ test: RegExp; message: string }> = [
  {
    test: /timed? ?out|timeout|ended before completion|ETIMEDOUT|\baborted\b/i,
    message: 'The model took too long to respond. Please try again.',
  },
  {
    test: /context (length|window)|too many tokens|maximum.{0,40}tokens|(input|prompt) is too long/i,
    message: 'This conversation is too long for the model. Start a new chat or shorten your message.',
  },
  {
    test: /\b429\b|rate.?limit|throttl|too many requests|quota/i,
    message: 'The AI service is busy right now. Wait a moment and try again.',
  },
  {
    test: /content.?filter|guardrail|responsible ?ai|content management policy/i,
    message: 'The model declined this request. Try rephrasing it.',
  },
  {
    test: /\b40[13]\b|unauthori[sz]ed|forbidden|access ?denied|expired ?token|invalid.{0,20}(api.?key|credential|token|key)/i,
    message: 'The AI service rejected the request. Ask an administrator to check the model configuration.',
  },
  {
    test: /\b50[0234]\b|overloaded|service ?unavailable|ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|ModelNotReady/i,
    message: 'The AI service is temporarily unavailable. Please try again shortly.',
  },
];

const DEFAULT_MESSAGE = 'Something went wrong while generating the reply. Please try again.';

export function rawErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export function clientStreamError(err: unknown, logLabel: string): string {
  const raw = rawErrorText(err);
  const ref = randomUUID().slice(0, 8);
  console.error(`[${logLabel}] stream error ref=${ref}:`, raw);
  const match = CATEGORIES.find((c) => c.test.test(raw));
  return `${match ? match.message : DEFAULT_MESSAGE} (ref ${ref})`;
}
