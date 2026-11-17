import { afterEach, describe, expect, it } from 'vitest';
import { ensureAuthPublicUrl } from '@/lib/auth-public-url';

const saved: Record<string, string | undefined> = {};

function stashEnv() {
  for (const k of ['NODE_ENV', 'NEXTAUTH_URL', 'NEXTAUTH_URL_INTERNAL', 'PORT', 'AUTH_PUBLIC_URL_FORCE']) {
    saved[k] = process.env[k];
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('ensureAuthPublicUrl', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('rewrites 127.0.0.1 to localhost in non-production', () => {
    stashEnv();
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://127.0.0.1:3000';
    delete process.env.NEXTAUTH_URL_INTERNAL;
    ensureAuthPublicUrl();
    expect(process.env.NEXTAUTH_URL).toBe('http://localhost:3000');
  });

  it('defaults missing URL to localhost and PORT', () => {
    stashEnv();
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3000';
    delete process.env.NEXTAUTH_URL;
    ensureAuthPublicUrl();
    expect(process.env.NEXTAUTH_URL).toBe('http://localhost:3000');
  });

  it('does not rewrite in production', () => {
    stashEnv();
    process.env.NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'http://127.0.0.1:3000';
    ensureAuthPublicUrl();
    expect(process.env.NEXTAUTH_URL).toBe('http://127.0.0.1:3000');
  });
});