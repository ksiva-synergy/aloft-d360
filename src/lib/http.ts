/**
 * Small HTTP helpers for App Router route handlers — the Next.js-adapted
 * replacement for the Express `http.ts` in the reference implementation.
 *
 * Usage:
 *   export const POST = handle(async (req) => {
 *     const body = parse(CreateUserSchema, await req.json());
 *     ...
 *     return created({ user });
 *   });
 */
import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';

/** Throwable error that `handle()` turns into a JSON response with a status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });
export const created = <T>(data: T) => NextResponse.json(data, { status: 201 });
export const noContent = () => new NextResponse(null, { status: 204 });
export const error = (status: number, message: string, details?: unknown) =>
  NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });

/** Pull client IP + user-agent from request headers, for audit records. */
export function clientMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null;
  return { ipAddress, userAgent: req.headers.get('user-agent') };
}

/** Validate `data` against a zod schema, throwing ApiError(400) on failure. */
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.flatten());
  }
  return result.data;
}

type Handler<C> = (req: Request, ctx: C) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler so thrown ApiError / ZodError / Prisma unique-violation
 * become clean JSON responses instead of unhandled 500s.
 */
export function handle<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return error(e.status, e.message, e.details);
      if (e instanceof ZodError) return error(400, 'Validation failed', e.flatten());
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') return error(409, 'Resource already exists');
      if (code === 'P2025') return error(404, 'Not found');
      console.error('[api] unhandled error', e);
      return error(500, 'Internal error');
    }
  };
}
