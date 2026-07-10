import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
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
            where: { email: credentials.email },
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        if ((user as any).rememberMe) {
          token.rememberMe = true;
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
