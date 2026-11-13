import prisma from '@/lib/db';

async function main(): Promise<void> {
  const rows = await prisma.platformContextSource.findMany({
    where: { connection_kind: 'powerbi' },
    select: { id: true, display_name: true, status: true, org_id: true },
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
