import 'server-only';
import prisma from '@/lib/db';
import type { ObjectT2Context } from './object-t2-context';

export type { ObjectT2Context } from './object-t2-context';

const T3_USAGE_SEMANTIC_STATUS = 'observed';

export async function loadObjectT2Context(objectId: string): Promise<ObjectT2Context | null> {
  const obj = await prisma.platformContextObject.findUnique({
    where: { id: objectId },
    select: {
      id: true,
      full_path: true,
      object_name: true,
      catalog_name: true,
      schema_name: true,
      columns: {
        where: { lifecycle: 'active' },
        select: { name: true, data_type: true, semantic: true },
        orderBy: { ordinal: 'asc' },
      },
    },
  });
  if (!obj) return null;

  const sem = await prisma.platformContextSemantic.findFirst({
    where: {
      subject_kind: 'object',
      subject_id: objectId,
      status: { not: T3_USAGE_SEMANTIC_STATUS },
    },
    orderBy: { version: 'desc' },
    select: { card: true },
  });

  const card =
    sem?.card && typeof sem.card === 'object' && !Array.isArray(sem.card)
      ? (sem.card as Record<string, unknown>)
      : null;

  return {
    id: obj.id,
    full_path: obj.full_path,
    object_name: obj.object_name,
    catalog_name: obj.catalog_name,
    schema_name: obj.schema_name,
    card,
    columns: obj.columns.map(c => ({
      name: c.name,
      data_type: c.data_type,
      semantic:
        c.semantic && typeof c.semantic === 'object' && !Array.isArray(c.semantic)
          ? (c.semantic as Record<string, unknown>)
          : null,
    })),
  };
}
