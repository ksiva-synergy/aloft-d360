import { BudgetExceededError } from '@/lib/spend/budgets';

/** SSE response when an interactive stream is blocked by a hard budget cap. */
export function budgetExceededStreamResponse(
  err: BudgetExceededError,
  modelKey: string,
): Response {
  const payload = JSON.stringify({
    type: 'error',
    message: err.message,
    code: 'BUDGET_EXCEEDED',
    recoverable: false,
    details: err.details,
  });
  const done = JSON.stringify({
    type: 'done',
    outcome: 'errored',
    loops: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    model: modelKey,
  });
  return new Response(`data: ${payload}\n\ndata: ${done}\n\n`, {
    status: 402,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
