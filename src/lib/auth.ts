import { NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/db';
import {
  provisionUserByOid,
  resolvePrimaryRole,
  resolveRoleLabel,
  isUsable,
  userAuthInclude,
  DEFAULT_ROLE,
  AccountLinkRequiredError,
} from '@/lib/rbac';
import { credentialsLoginEnabled, verifyCredentialsLogin } from '@/lib/auth-credentials';

/** Production idle lifetime. A session read issues a new cookie, so this is time since the app was last opened. */
const SESSION_MAX_AGE_PRODUCTION = 8 * 60 * 60;
/**
 * `next dev` / local Vite. Long enough that overnight and weekend work stays signed in.
 * Each successful `/api/auth/session` read renews it, so it lasts until Sign out as long as
 * the app is opened at least once in this window.
 */
const SESSION_MAX_AGE_LOCAL = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE =
  process.env.NODE_ENV === 'production' ? SESSION_MAX_AGE_PRODUCTION : SESSION_MAX_AGE_LOCAL;
const ROLE_RECHECK_MS = 5 * 60_000;

async function recordLoginEvent(params: {
  email: string;
  userId?: string | null;
  provider?: string;
  success: boolean;
  failureReason?: string;
  ip?: string | null;
  ua?: string | null;
}) {
  try {
    await prisma.loginEvent.create({
      data: {
        email: params.email,
        userId: params.userId ?? undefined,
        provider: params.provider ?? 'azure_ad',
        success: params.success,
        failureReason: params.failureReason ?? null,
        ipAddress: params.ip ?? null,
        userAgent: params.ua ?? null,
      },
    });
  } catch {
    // non-blocking: never fail auth because tracking write failed
  }
}

async function updateProfileOnLogin(userId: string, ip: string | null) {
  try {
    await prisma.userProfile.upsert({
      where: { userId },
      create: { userId, lastLoginAt: new Date(), lastLoginIp: ip, loginCount: 1 },
      update: { lastLoginAt: new Date(), lastLoginIp: ip, loginCount: { increment: 1 } },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
    });
  } catch {
    // non-blocking
  }
}

/**
 * Dev-only: next-auth reports every sign-in failure to the browser as one of a handful of generic codes (for example
 * `OAuthCallback`), and the real reason only goes to the server console. Mirror the error NAME and MESSAGE (never tokens,
 * codes or secrets) to .logs/next-auth.log so a failure can be diagnosed without hunting through terminals.
 */
function devAuthLog(level: 'error' | 'warn', code: string, metadata: unknown) {
  if (process.env.NODE_ENV === 'production') return;
  try {
    const m = metadata as { error?: { name?: string; message?: string }; message?: string; name?: string; providerId?: string } | undefined;
    const err = m?.error ?? m;
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      code,
      provider: m?.providerId,
      name: err?.name,
      message: String(err?.message ?? '').slice(0, 600),
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync('.logs', { recursive: true });
    fs.appendFileSync('.logs/next-auth.log', `${line}\n`);
  } catch {
    /* logging must never break sign-in */
  }
}

export const authOptions: NextAuthOptions = {
  logger: {
    error(code, metadata) {
      console.error('[next-auth][error]', code, metadata);
      devAuthLog('error', code, metadata);
    },
    warn(code) {
      console.warn('[next-auth][warn]', code);
      devAuthLog('warn', code, undefined);
    },
    debug() {},
  },
  providers: [
    ...(credentialsLoginEnabled()
      ? [
          CredentialsProvider({
            id: 'credentials',
            name: 'Email and password',
            credentials: {
              email: { label: 'Email', type: 'email' },
              password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
              const email = credentials?.email ?? '';
              const password = credentials?.password ?? '';
              return verifyCredentialsLogin(email, password);
            },
          }),
        ]
      : []),
    // Azure AD SSO — activated only when all three env vars are present
    ...(process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET &&
    process.env.AZURE_AD_TENANT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
            tenantId: process.env.AZURE_AD_TENANT_ID,
            wellKnown: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0/.well-known/openid-configuration`,
            authorization: {
              params: {
                scope: 'openid profile email User.Read',
              },
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'credentials') {
        const email = (user?.email ?? '').toLowerCase();
        const userId = (user as { id?: string })?.id;
        if (!userId || !email) {
          await recordLoginEvent({
            email: email || 'unknown',
            provider: 'credentials',
            success: false,
            failureReason: 'INVALID_CREDENTIALS',
          });
          return false;
        }
        await recordLoginEvent({ email, userId, provider: 'credentials', success: true });
        await updateProfileOnLogin(userId, null);
        return true;
      }

      if (account?.provider === 'azure-ad') {
        const p = (profile ?? {}) as Record<string, unknown>;
        const oid = (p.oid as string) ?? (p.sub as string) ?? undefined;
        const email = ((p.preferred_username as string) ?? (p.email as string) ?? user.email ?? '')
          .toString()
          .toLowerCase();

        if (!oid) {
          await recordLoginEvent({
            email: email || 'unknown',
            provider: 'azure_ad',
            success: false,
            failureReason: 'NO_OID_IN_TOKEN',
          });
          return false;
        }

        try {
          // SINGLE find-or-create-by-oid provisioning flow (see src/lib/rbac.ts).
          const dbUser = await provisionUserByOid({
            oid,
            tid: (p.tid as string) ?? null,
            email: email || null,
            name: (p.name as string) ?? user.name ?? null,
            groups: (p.groups as string[] | undefined) ?? undefined,
          });

          if (!isUsable(dbUser)) {
            const pending = dbUser.status === 'PENDING_APPROVAL';
            await recordLoginEvent({
              email,
              userId: dbUser.id,
              provider: 'azure_ad',
              success: false,
              failureReason: pending ? 'ACCESS_PENDING' : 'ACCOUNT_INACTIVE',
            });
            return pending ? '/login?error=ACCESS_PENDING' : '/login?error=ACCOUNT_SUSPENDED';
          }

          await recordLoginEvent({ email, userId: dbUser.id, provider: 'azure_ad', success: true });
          await updateProfileOnLogin(dbUser.id, null);
          return true;
        } catch (error) {
          // Email collides with an existing account — refuse to auto-link. Deny the
          // sign-in and redirect to the login page with a distinguishable reason.
          if (error instanceof AccountLinkRequiredError || (error as Error)?.name === 'AccountLinkRequiredError') {
            await recordLoginEvent({
              email,
              provider: 'azure_ad',
              success: false,
              failureReason: 'ACCOUNT_LINK_REQUIRED',
            });
            return '/login?error=account_link_required';
          }
          console.error('Azure AD sign-in error:', error);
          await recordLoginEvent({
            email,
            provider: 'azure_ad',
            success: false,
            failureReason: 'INTERNAL_ERROR',
          });
          return false;
        }
      }

      return false;
    },

    async jwt({ token, user, account, profile, trigger }) {
      // Initial sign-in — populate identity defaults from the provider user object.
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? DEFAULT_ROLE;
        token.roleLabel = (user as { roleLabel?: string }).roleLabel ?? resolveRoleLabel(token.role as string);
      }

      // AAD initial sign-in — resolve our user id + RBAC role from the oid claim
      if (account?.provider === 'azure-ad' && profile) {
        const oid = ((profile as Record<string, unknown>).oid as string) ?? undefined;
        if (oid) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { aadObjectId: oid },
              include: userAuthInclude,
            });
            if (dbUser) {
              token.id = dbUser.id;
              const role = resolvePrimaryRole(dbUser);
              token.role = role;
              token.roleLabel = resolveRoleLabel(role);
            }
          } catch (error) {
            console.error('Error resolving Azure AD user for JWT:', error);
          }
        }
      }

      // Re-resolve the role from the DB on sign-in/update and at most every ROLE_RECHECK_MS on
      // ordinary requests (trigger is undefined then), so demotions and suspensions take effect
      // within minutes instead of at the 8h token expiry.
      const lastCheck = typeof token.roleCheckedAt === 'number' ? token.roleCheckedAt : 0;
      const recheckDue = Date.now() - lastCheck > ROLE_RECHECK_MS;
      if (token.id && (trigger !== undefined || recheckDue)) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            include: userAuthInclude,
          });
          if (dbUser && isUsable(dbUser)) {
            const role = resolvePrimaryRole(dbUser);
            token.role = role;
            token.roleLabel = resolveRoleLabel(role);
            token.revoked = false;
          } else {
            // Deleted, suspended or deactivated: the proxy rejects revoked tokens on /api.
            token.revoked = true;
          }
          token.roleCheckedAt = Date.now();
        } catch {
          // Non-critical: keep existing token.role on DB error and retry on the next request
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token?.revoked) {
        session.error = 'SessionRevoked';
        return session;
      }
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.roleLabel = token.roleLabel as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE,
  },
  secret: process.env.NEXTAUTH_SECRET,
};
