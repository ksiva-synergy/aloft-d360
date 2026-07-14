/**
 * backfill-user-last-login.ts — one-time backfill so the Users table "Last Login"
 * column isn't empty for accounts that only ever logged in via the credentials
 * (password) provider.
 *
 * The Users table reads User.lastLoginAt, but the credentials login flow used to
 * only stamp UserProfile.lastLoginAt (see updateProfileOnLogin in src/lib/auth.ts).
 * The AAD flow already writes User.lastLoginAt directly, so only password accounts
 * were affected — most visibly admin@spinorlabs.io showing "—".
 *
 * The code path is now fixed to stamp User.lastLoginAt on every login. This script
 * repairs the *existing* rows by copying the newer of UserProfile.lastLoginAt /
 * User.lastSeenAt into User.lastLoginAt wherever User.lastLoginAt is still NULL.
 * It only fills NULLs, so it is idempotent and never clobbers a real value.
 *
 * Usage (repo root, staging/local env):
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/backfill-user-last-login.ts
 */

import { prisma } from '@/lib/db';

async function main() {
  const candidates = await prisma.user.findMany({
    where: { lastLoginAt: null },
    select: {
      id: true,
      email: true,
      lastSeenAt: true,
      profile: { select: { lastLoginAt: true } },
    },
  });

  console.log(`Found ${candidates.length} user(s) with NULL lastLoginAt`);

  let updated = 0;
  let skipped = 0;
  for (const u of candidates) {
    // Prefer the profile's recorded login time; fall back to lastSeenAt.
    const profileLogin = u.profile?.lastLoginAt ?? null;
    const source =
      profileLogin && u.lastSeenAt
        ? profileLogin > u.lastSeenAt
          ? profileLogin
          : u.lastSeenAt
        : (profileLogin ?? u.lastSeenAt);

    if (!source) {
      // No login has ever been recorded for this account (e.g. INVITED, never
      // signed in). Leave it NULL — "—" is the correct display.
      skipped++;
      continue;
    }

    await prisma.user.update({
      where: { id: u.id },
      data: { lastLoginAt: source },
    });
    console.log(`  ${u.email} ← ${source.toISOString()}`);
    updated++;
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped} (no login on record).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
