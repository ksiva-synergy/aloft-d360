import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

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
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  } catch {
    // non-blocking
  }
}

/**
 * Resolve the app role for an AAD user based on their group memberships.
 * If the user belongs to any group listed in AZURE_AD_ADMIN_GROUP_IDS, they get ADMIN.
 * Otherwise they get USER.
 */
function resolveRoleFromAzureGroups(azureGroupIds: string[]): 'ADMIN' | 'USER' {
  const adminGroupIds = (process.env.AZURE_AD_ADMIN_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (adminGroupIds.length === 0) return 'USER';
  return azureGroupIds.some((g) => adminGroupIds.includes(g)) ? 'ADMIN' : 'USER';
}

export const authOptions: NextAuthOptions = {
  providers: [
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

        if (!user.isActive) {
          await recordLoginEvent({
            email: credentials.email,
            userId: user.id,
            success: false,
            failureReason: 'ACCOUNT_INACTIVE',
            ip,
            ua,
          });
          return null;
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

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          role: user.role,
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
        const email = user.email?.toLowerCase();
        if (!email) {
          await recordLoginEvent({
            email: user.email || 'unknown',
            provider: 'azure_ad',
            success: false,
            failureReason: 'NO_EMAIL_IN_TOKEN',
          });
          return false;
        }

        try {
          const azureGroups = ((profile as any)?.groups || []) as string[];

          // Find or auto-provision user
          let dbUser = await prisma.user.findUnique({ where: { email } });

          if (!dbUser) {
            const targetRole = resolveRoleFromAzureGroups(azureGroups);
            dbUser = await prisma.user.create({
              data: {
                email,
                name: user.name ?? '',
                passwordHash: '',
                authProvider: 'azure_ad',
                isActive: true,
                role: targetRole,
              },
            });
          }

          if (!dbUser.isActive) {
            await recordLoginEvent({
              email,
              userId: dbUser.id,
              provider: 'azure_ad',
              success: false,
              failureReason: 'ACCOUNT_INACTIVE',
            });
            return false;
          }

          // Sync role from AAD groups on every login (allows real-time role changes in AAD)
          const resolvedRole = resolveRoleFromAzureGroups(azureGroups);
          if (dbUser.role !== resolvedRole) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { role: resolvedRole },
            });
          }

          await prisma.user.update({
            where: { id: dbUser.id },
            data: { lastSeenAt: new Date() },
          });

          await recordLoginEvent({ email, userId: dbUser.id, provider: 'azure_ad', success: true });
          await updateProfileOnLogin(dbUser.id, null);

          return true;
        } catch (error) {
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

    async jwt({ token, user, account }) {
      // Initial sign-in — credentials flow populates from the user object
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        if ((user as any).rememberMe) {
          token.rememberMe = true;
        }
      }

      // For Azure AD users, fetch role from DB (since AAD user object doesn't carry our role)
      if (account?.provider === 'azure-ad' && token.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email.toLowerCase() },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role;
          }
        } catch (error) {
          console.error('Error fetching Azure AD user for JWT:', error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
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
