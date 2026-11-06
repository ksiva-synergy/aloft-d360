// Pure, client-safe helpers (the SPA imports this via useInspectorChatModels). The server-only
// session lookup lives in ./session-role so NextAuth and Prisma stay out of the browser bundle.
import type { ModelOption } from '@/components/agent-lab/workbench/types';
import { DEFAULT_INSPECTOR_MODEL_KEY } from '@/lib/inspector/default-model';
import { fromLlmLiteModelKey, toLlmLiteModelKey } from '@/lib/llmlite/keys';
import type { RoleModelAccessConfig, RoleModelPolicy } from '@/lib/llmlite/model-registry';

function resolvePolicyForRole(
  role: string | null | undefined,
  accessConfig?: RoleModelAccessConfig,
): RoleModelPolicy | null {
  if (!role || !accessConfig?.rolePolicies) return null;
  return accessConfig.rolePolicies[role] ?? null;
}

export function isPlatformAdminRole(role: string | null | undefined, accessConfig?: RoleModelAccessConfig): boolean {
  if (!role) return false;
  const policy = resolvePolicyForRole(role, accessConfig);
  if (policy) {
    return policy.mode === 'all_enabled';
  }
  if (accessConfig?.fullPickerRoles?.length) {
    return accessConfig.fullPickerRoles.includes(role);
  }
  return role === 'platform_admin';
}

/** Chat / workbench model key allowed for this RBAC role (server enforcement). */
export function chatModelKeyForRole(
  requested: string | undefined,
  role: string | null | undefined,
  accessConfig?: RoleModelAccessConfig,
  defaultModelKey: string = DEFAULT_INSPECTOR_MODEL_KEY,
): string {
  const policy = resolvePolicyForRole(role, accessConfig);
  if (policy) {
    const roleDefaultKey = policy.defaultModelId
      ? toLlmLiteModelKey(policy.defaultModelId)
      : defaultModelKey;
    if (policy.mode === 'all_enabled') {
      return requested ?? roleDefaultKey;
    }
    if (policy.mode === 'custom_list') {
      if (!requested) return roleDefaultKey;
      const reqGatewayId = fromLlmLiteModelKey(requested) ?? requested;
      const allowedSet = new Set(policy.allowedModelIds);
      if (allowedSet.has(reqGatewayId) || allowedSet.has(requested)) {
        return toLlmLiteModelKey(reqGatewayId);
      }
      return roleDefaultKey;
    }
    // locked_default
    return roleDefaultKey;
  }

  if (isPlatformAdminRole(role, accessConfig)) {
    return requested ?? defaultModelKey;
  }
  if (accessConfig?.standardUserDefaultModelId) {
    return toLlmLiteModelKey(accessConfig.standardUserDefaultModelId);
  }
  return defaultModelKey;
}

export function filterChatModelsForRole(
  models: ModelOption[],
  role: string | null | undefined,
  accessConfig?: RoleModelAccessConfig,
  defaultModelKey: string = DEFAULT_INSPECTOR_MODEL_KEY,
): ModelOption[] {
  const policy = resolvePolicyForRole(role, accessConfig);
  if (policy) {
    if (policy.mode === 'all_enabled') return models;
    if (policy.mode === 'custom_list') {
      const allowedKeys = new Set(
        policy.allowedModelIds.flatMap((id) => [id, toLlmLiteModelKey(id)]),
      );
      if (policy.defaultModelId) {
        allowedKeys.add(toLlmLiteModelKey(policy.defaultModelId));
      }
      const matched = models.filter((m) => allowedKeys.has(m.key));
      if (matched.length > 0) return matched;
    }
    // locked_default (or custom_list fallback)
    const targetKey = policy.defaultModelId
      ? toLlmLiteModelKey(policy.defaultModelId)
      : defaultModelKey;
    const single = models.filter((m) => m.key === targetKey);
    if (single.length > 0) return single;
  }

  if (isPlatformAdminRole(role, accessConfig)) return models;
  const targetKey = accessConfig?.standardUserDefaultModelId
    ? toLlmLiteModelKey(accessConfig.standardUserDefaultModelId)
    : defaultModelKey;
  const matched = models.filter((m) => m.key === targetKey);
  if (matched.length > 0) return matched;
  const fallback = models.filter((m) => m.key === DEFAULT_INSPECTOR_MODEL_KEY);
  return fallback.length > 0 ? fallback : models.slice(0, 1);
}

