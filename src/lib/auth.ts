import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import {
  provisionUserByOid,
  resolvePrimaryRole,
  resolveRoleLabel,
  isUsable,
  userAuthInclude,
  DEFAULT_ROLE,
  AccountLinkRequiredError,
} from '@/lib/rbac';

const SESSION_MAX_AGE_DEFAULT = 8 * 60 * 60; // 8 hours
const SESSION_MAX_AGE_REMEMBER = 30 * 24 * 60 * 60; // 30 days

function extractIpAndUa(req: any): { ip: string | null; ua: string | null } {
  const headers = req?.headers ?? {};
  const ip =
    headers['x-forwarded-for']?.split(',')[0]?.trim() ??
    headers['x-real-ip'] ??
    null;
  const ua = headers['user-agent'] ?? null;
  return { ip, ua };
}

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
        provider: params.provider ?? 'credentials',
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

/** Resolve a user's coarse role string (primary RBAC role) for the session/JWT. */
async function primaryRoleForUser(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: userAuthInclude });
  return u ? resolvePrimaryRole(u) : DEFAULT_ROLE;
}

export const authOptions: NextAuthOptions = {
  providers: [
    // Break-glass local admin (optional). Only usable by accounts that actually
    // have a passwordHash — AAD users have none and cannot log in this way.
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        rememberMe: { label: 'Remember Me', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const { ip, ua } = extractIpAndUa(req);

        let user: Awaited<ReturnType<typeof prisma.user.findUnique>>;
        try {
          user = await prisma.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
          });
        } catch {
          return null;
        }

        if (!user) {
          await recordLoginEvent({
            email: credentials.email,
            success: false,
            failureReason: 'USER_NOT_FOUND',
            ip,
            ua,
          });
          return null;
        }

        // AAD-only accounts have no local password to check against.
        if (!user.passwordHash) {
          await recordLoginEvent({
            email: credentials.email,
            userId: user.id,
            success: false,
            failureReason: 'NO_LOCAL_PASSWORD',
            ip,
            ua,
          });
          return null;
        }

        if (user.status !== 'ACTIVE' || !user.isActive || user.deletedAt) {
          await recordLoginEvent({
            email: credentials.email,
            userId: user.id,
            success: false,
            failureReason: 'ACCOUNT_INACTIVE',
            ip,
            ua,
          });
          throw new Error('ACCOUNT_SUSPENDED');
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          await recordLoginEvent({
            email: credentials.email,
            userId: user.id,
            success: false,
            failureReason: 'INVALID_PASSWORD',
            ip,
            ua,
          });
          return null;
        }

        await recordLoginEvent({ email: credentials.email, userId: user.id, success: true, ip, ua });
        await updateProfileOnLogin(user.id, ip);

        const role = await primaryRoleForUser(user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role,
          roleLabel: resolveRoleLabel(role),
          rememberMe: credentials.rememberMe === '1',
        };
      },
    }),
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
            await recordLoginEvent({
              email,
              userId: dbUser.id,
              provider: 'azure_ad',
              success: false,
              failureReason: 'ACCOUNT_INACTIVE',
            });
            return '/login?error=ACCOUNT_SUSPENDED';
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

      // Credentials provider — allow through (authorize already validated)
      return true;
    },

    async jwt({ token, user, account, profile, trigger }) {
      // Initial sign-in — credentials flow populates from the user object
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? DEFAULT_ROLE;
        token.roleLabel = (user as { roleLabel?: string }).roleLabel ?? resolveRoleLabel(token.role as string);
        if ((user as { rememberMe?: boolean }).rememberMe) {
          token.rememberMe = true;
        }
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

      // On every token refresh (trigger === 'update' or subsequent requests), re-resolve the
      // role from the DB so that role changes by an admin take effect without requiring
      // the user to sign out and back in.
      if (trigger !== undefined && token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            include: userAuthInclude,
          });
          if (dbUser && isUsable(dbUser)) {
            const role = resolvePrimaryRole(dbUser);
            token.role = role;
            token.roleLabel = resolveRoleLabel(role);
          }
        } catch {
          // Non-critical: keep existing token.role on DB error
        }
      }

      return token;
    },

    async session({ session, token }) {
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
    maxAge: SESSION_MAX_AGE_DEFAULT,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_REMEMBER,
  },
  secret: process.env.NEXTAUTH_SECRET,
};
