import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    error?: 'SessionRevoked';
    user: {
      id: string;
      role: string;
      roleLabel: string;
    } & DefaultSession['user'];
  }

  interface User {
    role: string;
    roleLabel?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    roleLabel?: string;
    revoked?: boolean;
    roleCheckedAt?: number;
  }
}
