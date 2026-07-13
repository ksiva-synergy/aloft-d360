import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
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
  }
}
