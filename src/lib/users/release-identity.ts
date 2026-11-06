/**
 * Removing a user must free the email and the Microsoft id. The row stays so
 * sessions and audit history keep their foreign keys, but the address can be
 * invited again as a brand-new account.
 */
export function retiredEmail(userId: string): string {
  return `retired.${userId}@removed.local`;
}

export function releasedIdentityData(userId: string) {
  return {
    email: retiredEmail(userId),
    aadObjectId: null,
    username: null,
    status: 'DEACTIVATED' as const,
    isActive: false,
    deletedAt: new Date(),
  };
}
