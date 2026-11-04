import prisma from '@/lib/db';

async function main() {
  const rows = await prisma.platformContextObject.findMany({
    where: {
      lifecycle: 'active',
      OR: [
        { full_path: { contains: 'employee_master' } },
        { full_path: { contains: 'darwin_box' } },
      ],
    },
    select: {
      full_path: true,
      catalog_name: true,
      schema_name: true,
      object_name: true,
      last_t3_at: true,
      source_id: true,
    },
    take: 30,
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => prisma.$disconnect());
