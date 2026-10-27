// Pure, client-safe helpers (the SPA imports this via useInspectorChatModels). The server-only
// session lookup lives in ./session-role so NextAuth and Prisma stay out of the browser bundle.
import type { ModelOption } from '@/components/agent-lab/workbench/types';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';

export function isPlatformAdminRole(role: string | null | undefined): boolean {
  return role === 'platform_admin';
}

/** Chat / workbench model key allowed for this RBAC role (server enforcement). */
export function chatModelKeyForRole(
  requested: string | undefined,
  role: string | null | undefined,
): string {
  if (isPlatformAdminRole(role)) {
    return requested ?? DEFAULT_INSPECTOR_MODEL_KEY;
  }
  return DEFAULT_INSPECTOR_MODEL_KEY;
}

export function filterChatModelsForRole(
  models: ModelOption[],
  role: string | null | undefined,
): ModelOption[] {
  if (isPlatformAdminRole(role)) return models;
  const grok = models.filter((m) => m.key === DEFAULT_INSPECTOR_MODEL_KEY);
  if (grok.length > 0) return grok;
  return models.filter((m) => m.key === DEFAULT_INSPECTOR_MODEL_KEY);
}
