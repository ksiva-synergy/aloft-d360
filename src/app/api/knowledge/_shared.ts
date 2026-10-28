import { resolveAuth, requirePermission } from '@/middleware/auth';
import { PERMISSIONS } from '@/lib/rbac';
import { getDefaultOrg } from '@/lib/org';
import { isAdmin, type KnowledgeActor } from '@/lib/knowledge/access';
import { maxUploadBytes } from '@/lib/knowledge/service';
import { knowledgeBucket } from '@/lib/knowledge/store';

// Shared by the knowledge routes. Not a route file: Next only routes `route.ts`.
// Anyone who builds automations (inspector:use) can use knowledge bases; what each person may see or
// change is decided per knowledge base in src/lib/knowledge/access.ts.

export async function knowledgeActor(req: Request): Promise<KnowledgeActor> {
  const auth = await resolveAuth(req);
  requirePermission(auth, PERMISSIONS.INSPECTOR_USE);
  return { userId: auth.userId, role: auth.role, orgId: getDefaultOrg().id };
}

/**
 * What the page needs to know about this person and the setup: whether to offer organisation
 * knowledge bases and sharing (the server still checks), and whether file storage is set up and
 * the size limit, so the page can say so before anyone picks files.
 */
export function pageContext(actor: KnowledgeActor) {
  return { isAdmin: isAdmin(actor), uploads: { ready: !!knowledgeBucket(), maxMb: maxUploadBytes() / 1048576 } };
}
