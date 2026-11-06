// Who may see and change a knowledge base (Phase 1: personal and organisation; teams in Phase 2).
//   personal — the owner sees and manages it; platform admins too.
//   org      — everyone in the organisation can search it; admins and platform admins manage it,
//              and only they can create one or promote a personal one (decision 2026-10-27).
// Archived knowledge bases are never searched, and are hidden from everyone but admins and, for a
// personal one, its owner (so they can restore it).
// Knowledge bases that are not user files (type DATABASE / API / SAAS, from the estate sync) are not
// managed here.

export type KnowledgeActor = { userId: string; role: string; orgId: string };
export type KnowledgeBaseAccessRow = { org_id: string; scope: string; owner_id: string | null; archived_at: Date | null; type: string };

export const isPlatformAdmin = (a: KnowledgeActor) => a.role === 'platform_admin';
export const isAdmin = (a: KnowledgeActor) => a.role === 'admin' || a.role === 'platform_admin';

export function canSee(a: KnowledgeActor, kb: KnowledgeBaseAccessRow): boolean {
  if (kb.org_id !== a.orgId || kb.type !== 'FILE') return false;
  if (kb.archived_at && !isAdmin(a) && !(kb.scope === 'personal' && kb.owner_id === a.userId)) return false;
  if (isPlatformAdmin(a)) return true;
  if (kb.scope === 'org') return true;
  if (kb.scope === 'personal') return kb.owner_id === a.userId;
  return false; // team knowledge bases arrive with Phase 2
}

export function canManage(a: KnowledgeActor, kb: KnowledgeBaseAccessRow): boolean {
  if (!canSee(a, kb)) return false;
  if (isPlatformAdmin(a)) return true;
  if (kb.scope === 'org') return isAdmin(a);
  return kb.owner_id === a.userId;
}

/** Searchable: visible and not archived. */
export const canSearch = (a: KnowledgeActor, kb: KnowledgeBaseAccessRow) => canSee(a, kb) && !kb.archived_at;

export function canCreate(a: KnowledgeActor, scope: string): boolean {
  if (scope === 'personal') return true;
  if (scope === 'org') return isAdmin(a);
  return false;
}
