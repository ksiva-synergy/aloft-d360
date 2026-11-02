import { z } from 'zod';
import { Prisma } from '@prisma/client';

// Request contracts for tool catalog writes. id and timestamps are never accepted; unknown keys are stripped.

const isObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
const jsonObject = z.custom<Prisma.InputJsonValue>(isObject, 'expected a JSON object');
// Nullable JSON columns need Prisma's DbNull sentinel rather than a literal null.
const nullableJsonObject = jsonObject
  .nullable()
  .transform((v): Prisma.InputJsonValue | typeof Prisma.DbNull => (v === null ? Prisma.DbNull : v));

const editable = {
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  description: z.string().max(5000).nullable(),
  config: jsonObject,
  tags: z.array(z.string().max(60)).max(50),
  status: z.string().trim().min(1).max(40),
  author: z.string().trim().max(200).nullable(),
  input_schema: nullableJsonObject,
  output_schema: nullableJsonObject,
  version: z.string().trim().max(40).nullable(),
  tier: z.string().trim().max(40),
  owner: z.string().trim().max(200).nullable(),
};

export const toolCreateSchema = z
  .object(editable)
  .partial()
  .extend({ name: editable.name, type: editable.type });

export const toolUpdateSchema = z.object(editable).partial();

export const TOOL_ORDER_FIELDS = ['updated_at', 'created_at', 'name', 'type', 'status', 'tier'] as const;
