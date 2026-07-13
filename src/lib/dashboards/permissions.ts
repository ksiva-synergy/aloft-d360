/**
 * src/lib/dashboards/permissions.ts
 *
 * Server-side permission resolution for platform dashboards.
 * All functions are safe to call from API route handlers.
 */

import prisma from '@/lib/db';
import type { DashboardRole, DashboardVisibility } from './types';

// ── Role resolution ────────────────────────────────────────────────────────────

/**
 * Returns the effective role for a user on a dashboard.
 * Resolution order: explicit collaborator row → org visibility fallback → null.
 *
 * @param dashboardId - The dashboard id
 * @param userId      - The authenticated user's id (from session)
 * @param visibility  - The dashboard's visibility field (avoids extra query when already loaded)
 */
export async function getDashboardRole(
  dashboardId: string,
  userId: string,
  visibility?: string,
): Promise<DashboardRole | null> {
  const collaborator = await prisma.platform_dashboard_collaborators.findUnique({
    where: {
      dashboard_id_user_id: { dashboard_id: dashboardId, user_id: userId },
    },
  });

  if (collaborator) {
    return collaborator.role as DashboardRole;
  }

  // Fall back to visibility-based access
  const vis = visibility ?? (await prisma.platform_dashboards.findUnique({
    where: { id: dashboardId },
    select: { visibility: true },
  }))?.visibility;

  if (vis === 'org' || vis === 'shared') {
    return 'org_member';
  }

  return null;
}

// ── Permission predicates ──────────────────────────────────────────────────────

export function canEditDashboard(role: DashboardRole | null): boolean {
  return role === 'owner' || role === 'editor';
}

export function canShareDashboard(role: DashboardRole | null): boolean {
  return role === 'owner' || role === 'editor';
}

export function canDeleteDashboard(role: DashboardRole | null): boolean {
  return role === 'owner';
}

export function canViewDashboard(role: DashboardRole | null): boolean {
  return role !== null;
}

// ── Visibility-aware list filter ───────────────────────────────────────────────

/**
 * Returns a Prisma WHERE clause fragment that filters dashboards to only those
 * the given user is permitted to see.
 *
 * A user can see a dashboard if:
 *   1. They are an explicit collaborator (any role), OR
 *   2. The dashboard visibility is 'org' or 'shared'
 */
export function buildDashboardVisibilityFilter(userId: string) {
  return {
    deleted_at: null,
    OR: [
      {
        platform_dashboard_collaborators: {
          some: { user_id: userId },
        },
      },
      { visibility: 'org' },
      { visibility: 'shared' },
    ],
  } as const;
}

// ── Helper: resolve userId from session email ──────────────────────────────────

/**
 * Look up a User row by email (which is what NextAuth stores in session.user.email).
 * Returns null if not found.
 */
export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    // NOTE: the coarse `role` enum column was removed in the RBAC migration.
    // Derive role/permissions from the `roles` join if ever needed here.
    select: { id: true, name: true, email: true },
  });
}

// ── Coerce visibility string ───────────────────────────────────────────────────

export function coerceVisibility(v: unknown): DashboardVisibility {
  if (v === 'private' || v === 'org' || v === 'shared') return v;
  return 'org';
}
