import 'server-only';

import { prisma } from '@/lib/db';
import {
  createDefaultModelSettings,
  normalizeModelSettings,
  type ModelFeatureId,
  type PlatformModelSettings,
} from './model-registry';

const POLICY_SLUG = 'platform-model-settings';
const POLICY_TYPE = 'model_governance';
const CACHE_TTL_MS = 15_000;

let cachedSettings: PlatformModelSettings | null = null;
let cachedAt = 0;

/**
 * Synchronous accessor returning the most recently loaded settings (or defaults).
 * Kept warm by `loadModelSettings()` in API routes and background jobs.
 */
export function getCachedModelSettings(): PlatformModelSettings {
  return cachedSettings ?? createDefaultModelSettings();
}

export function getFeatureGatewayModelIdSync(feature: ModelFeatureId): string {
  const settings = getCachedModelSettings();
  return settings.featureModels[feature] || settings.defaultGatewayModelId;
}

export async function loadModelSettings(forceRefresh = false): Promise<PlatformModelSettings> {
  const now = Date.now();
  if (!forceRefresh && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const row = await prisma.policy_entry.findFirst({
      where: { slug: POLICY_SLUG },
      orderBy: { updated_at: 'desc' },
    });
    const normalized = normalizeModelSettings(row?.config);
    if (row?.updated_at && !normalized.updatedAt) {
      normalized.updatedAt = row.updated_at.toISOString();
    }
    cachedSettings = normalized;
    cachedAt = now;
    return normalized;
  } catch {
    const fallback = cachedSettings ?? createDefaultModelSettings();
    cachedSettings = fallback;
    cachedAt = now;
    return fallback;
  }
}

export async function getFeatureGatewayModelId(feature: ModelFeatureId): Promise<string> {
  const settings = await loadModelSettings();
  return settings.featureModels[feature] || settings.defaultGatewayModelId;
}

export async function saveModelSettings(
  patch: Partial<PlatformModelSettings>,
  actorEmailOrId?: string,
): Promise<PlatformModelSettings> {
  const current = await loadModelSettings(true);
  const merged = normalizeModelSettings({
    ...current,
    ...patch,
    featureModels: {
      ...current.featureModels,
      ...(patch.featureModels ?? {}),
    },
    roleAccess: {
      ...current.roleAccess,
      ...(patch.roleAccess ?? {}),
    },
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmailOrId ?? current.updatedBy,
  });

  const existing = await prisma.policy_entry.findFirst({
    where: { slug: POLICY_SLUG },
    orderBy: { updated_at: 'desc' },
  });

  if (existing) {
    await prisma.policy_entry.update({
      where: { id: existing.id },
      data: {
        name: 'Platform Model & AI Gateway Settings',
        type: POLICY_TYPE,
        scope: 'global',
        enforcement: 'block',
        status: 'active',
        config: merged as unknown as object,
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.policy_entry.create({
      data: {
        name: 'Platform Model & AI Gateway Settings',
        slug: POLICY_SLUG,
        type: POLICY_TYPE,
        scope: 'global',
        enforcement: 'block',
        status: 'active',
        config: merged as unknown as object,
      },
    });
  }

  cachedSettings = merged;
  cachedAt = Date.now();
  return merged;
}
