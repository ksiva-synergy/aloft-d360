import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError, clientMeta, created, handle, parse } from '@/lib/http';
import { resolveAuth } from '@/middleware/auth';
import { writeAudit } from '@/lib/audit';
import { defaultLevels } from '@/lib/sections/registry';
import {
  BaseRoleSchema,
  BundleLevelsSchema,
  BundleNameSchema,
  requirePlatformAdminForBundles,
  setBundleLevels,
} from '@/lib/sections/bundles';

export const dynamic = 'force-dynamic';

const CreateBundle = z
  .object({
    kind: z.enum(['bundle', 'role']).default('bundle'),
    name: BundleNameSchema,
    description: z.string().trim().max(300).optional(),
    /** Custom roles only: the built-in role it starts from. */
    base: BaseRoleSchema.optional(),
    levels: BundleLevelsSchema.optional(),
  })
  .refine((b) => b.kind === 'bundle' || b.base, { message: 'A custom role needs a starting role', path: ['base'] });

/** Create a bundle or a custom role (platform admins only). A custom role starts from its base role's levels. */
export const POST = handle(async (req) => {
  const auth = await resolveAuth(req);
  requirePlatformAdminForBundles(auth);
  const body = parse(CreateBundle, await req.json());

  const taken = await prisma.role.findUnique({ where: { name: body.name }, select: { id: true } });
  if (taken) throw new ApiError(409, `A role or bundle called "${body.name}" already exists`);

  const base = body.kind === 'role' ? body.base! : null;
  const role = await prisma.role.create({
    data: { name: body.name, description: body.description || null, isSystem: false },
    select: { id: true, name: true },
  });
  const keys = await setBundleLevels(role.id, body.levels ?? (base ? defaultLevels(base) : {}), base);

  await writeAudit({
    actorId: auth.userId,
    action: body.kind === 'role' ? 'section_role.created' : 'section_bundle.created',
    entityType: 'role',
    entityId: role.id,
    after: { name: role.name, kind: body.kind, base, description: body.description ?? null, keys },
    ...clientMeta(req),
  });
  return created({ bundle: { id: role.id, name: role.name, kind: body.kind } });
});
