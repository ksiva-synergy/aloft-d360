import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { isPrismaUnreachable, withPrismaReadRetry } from '../with-prisma-read-retry';

function p1001(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
    code: 'P1001',
    clientVersion: '5.22.0',
  });
}

describe('withPrismaReadRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withPrismaReadRetry(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after P1001', async () => {
    const fn = vi.fn().mockRejectedValueOnce(p1001()).mockResolvedValueOnce('ok');
    await expect(withPrismaReadRetry(fn, { backoffMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry other Prisma codes', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withPrismaReadRetry(fn, { backoffMs: 0 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isPrismaUnreachable', () => {
  it('detects P1001', () => {
    expect(isPrismaUnreachable(p1001())).toBe(true);
  });
});
