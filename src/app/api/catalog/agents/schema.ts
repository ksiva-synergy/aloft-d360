import { z } from 'zod';
import type { Prisma } from '@prisma/client';

// Request contracts for catalog agent writes. Ownership and lineage fields (owner_id, parent_id,
// is_head, draft_of_id, id, timestamps) are never accepted from the client; unknown keys are stripped.

const isObject = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
const jsonObject = z.custom<Prisma.InputJsonValue>(isObject, 'expected a JSON object');
const jsonArray = z.custom<Prisma.InputJsonValue>((v) => Array.isArray(v), 'expected a JSON array');

const editable = {
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  description: z.string().max(5000).nullable(),
  version: z.string().trim().max(40),
  config: jsonObject,
  tools: jsonArray,
  input_schema: jsonObject,
  output_schema: jsonObject,
  bus_subscriptions: jsonArray,
  bus_publications: jsonArray,
  tags: z.array(z.string().max(60)).max(50),
  status: z.string().trim().max(40),
  author: z.string().trim().max(200).nullable(),
  reviewers: jsonArray,
  policy_ids: z.array(z.string().max(100)).max(50),
};

export const catalogAgentCreateSchema = z
  .object(editable)
  .partial()
  .extend({ name: editable.name, type: editable.type, slug: z.string().trim().min(1).max(200).optional() });

export const catalogAgentUpdateSchema = z.object(editable).partial();

export const catalogAgentForkSchema = z.object({
  name: editable.name.optional(),
  version: editable.version.optional(),
});
