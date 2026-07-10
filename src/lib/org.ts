// Synchronous org resolver for contexts that can't await (e.g. Marcus DAL).
// Reads DEFAULT_ORG_ID — the same org configured via DEFAULT_ORG_SLUG for the async path.
// Both must be set together in .env.local / Vercel env.
export function getDefaultOrg() {
  const id = process.env.DEFAULT_ORG_ID;
  if (!id) {
    throw new Error(
      '[getDefaultOrg sync] DEFAULT_ORG_ID env var is not set. ' +
      'This is required for org resolution. See infra/context/deploy-notes.md.',
    );
  }
  return { id };
}
