/**
 * Detects a final reply that stopped because it hit the output-token cap, and
 * makes that visible instead of silently showing a half-finished answer.
 *
 * Every Inspector / agent model call caps output at 4096 tokens. A long typed
 * markdown table (a few hundred rows) overruns that, so before this the table
 * just ended partway through with no sign it was incomplete.
 */

/** Provider stop reasons that mean "ran out of output tokens". */
const OUTPUT_CAP_REASONS = new Set([
  'max_tokens',        // Bedrock Converse / Anthropic
  'length',            // OpenAI-style chat completions finish_reason
  'max_output_tokens', // OpenAI Responses incomplete_details.reason
]);

export function isOutputCapStop(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && OUTPUT_CAP_REASONS.has(reason);
}

export const REPLY_CUT_OFF_NOTICE =
  '_This reply reached its length limit and stopped early, so the list above may be incomplete. ' +
  'Ask for a summary or a narrower list to see the rest._';

/**
 * Final text for a reply that hit the output cap: drops a half-written last line
 * (usually a table row cut mid-cell, which renders as a broken row) and appends
 * the cut-off notice. Idempotent.
 */
export function finishCutOffReply(text: string): string {
  if (text.includes(REPLY_CUT_OFF_NOTICE)) return text;
  let body = text.replace(/\s+$/, '');
  const lastBreak = body.lastIndexOf('\n');
  if (lastBreak >= 0) {
    const lastLine = body.slice(lastBreak + 1).trim();
    // A complete markdown table row starts and ends with a pipe.
    if (lastLine.startsWith('|') && !lastLine.endsWith('|')) {
      body = body.slice(0, lastBreak).replace(/\s+$/, '');
    }
  }
  return body ? `${body}\n\n${REPLY_CUT_OFF_NOTICE}` : REPLY_CUT_OFF_NOTICE;
}
