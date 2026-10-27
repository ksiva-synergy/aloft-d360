import { z } from 'zod';
import type { Prisma } from '@prisma/client';

// Request contracts for policy writes. Unknown keys (id, timestamps sent back by the editor) are stripped.

const fields = {
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  scope: z.string().trim().max(60).optional(),
  scope_id: z.string().trim().max(200).nullable().optional(),
  config: z.custom<Prisma.InputJsonValue>((v) => v !== null && typeof v === 'object' && !Array.isArray(v), 'expected a JSON object').optional(),
  enforcement: z.enum(['warn', 'block', 'log']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
};

export const policyCreateSchema = z.object({ ...fields, slug: z.string().trim().min(1).max(200).optional() });
export const policyUpdateSchema = z.object(fields).partial();
