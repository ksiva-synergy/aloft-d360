import { send } from '@/components/access/console/api';
import { buildAgentAccessRequestPurpose } from '@/lib/access/request-purpose';

export async function submitPathAccessRequests(input: {
  paths: string[];
  /** Inspector / agent context (question text), not table names from the user. */
  userQuestion?: string;
  reason: string;
  level?: 'query' | 'export';
  durationDays?: number | null;
  ticketRef?: string | null;
}): Promise<string[]> {
  const paths = [...new Set(input.paths.map((p) => p.toLowerCase()))].filter((p) => p.split('.').length === 3);
  if (paths.length === 0) throw new Error('Pick at least one table.');
  const bundle =
    paths.length > 1 ? input.ticketRef?.trim() || `bundle-${Date.now()}` : input.ticketRef?.trim() || null;
  const purpose = buildAgentAccessRequestPurpose({ paths, userQuestion: input.userQuestion, bundleRef: bundle });
  const body = {
    targetType: 'path' as const,
    tagId: null,
    level: input.level ?? 'query',
    durationDays: input.durationDays ?? 30,
    purpose,
    reason: input.reason.trim(),
    ticketRef: bundle,
  };
  const numbers: string[] = [];
  for (const p of paths) {
    const res = await send<{ request: { number: string } }>('/api/access/requests', 'POST', { ...body, path: p });
    numbers.push(res.request.number);
  }
  return numbers;
}
