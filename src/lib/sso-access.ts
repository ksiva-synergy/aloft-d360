/**
 * SSO just-in-time provisioning policy. When admin approval is required, first-time
 * Entra sign-ins create a PENDING_APPROVAL user with no role until a platform admin admits them.
 */

/** When true, skip approval and auto-activate new SSO users with the default member role (dev / legacy). */
export function ssoRequiresAdminApproval(): boolean {
  if (process.env.SSO_JIT_AUTO_ACTIVATE === 'true') return false;
  return process.env.SSO_REQUIRE_ADMIN_APPROVAL !== 'false';
}

export function entraAdminGroupIds(): string[] {
  return (process.env.AZURE_AD_ADMIN_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the token's groups claim lists a configured Entra admin group (positive signal only). */
export function isEntraAdminGroupMember(groups: string[] | undefined): boolean {
  const ids = entraAdminGroupIds();
  if (ids.length === 0 || !groups?.length) return false;
  return groups.some((g) => ids.includes(g));
}
