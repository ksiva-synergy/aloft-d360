import 'server-only';

import { matchVerifiedQueries, type VerifiedQueryHit } from '@/lib/powerbi/verified-query-match';
import { formatVerifiedQueryBlock } from '@/lib/inspector/verified-query-format';

export { formatVerifiedQueryBlock } from '@/lib/inspector/verified-query-format';

export async function buildVerifiedQueryContext(
  orgId: string,
  userMessage: string,
): Promise<{ text: string; hits: VerifiedQueryHit[] }> {
  const q = userMessage.trim();
  if (!q) return { text: '', hits: [] };

  try {
    const hits = await matchVerifiedQueries(orgId, q, { limit: 3 });
    return { text: formatVerifiedQueryBlock(hits), hits };
  } catch (err) {
    console.warn(
      '[verified-query-context] match failed (non-fatal):',
      err instanceof Error ? err.message : String(err),
    );
    return { text: '', hits: [] };
  }
}
