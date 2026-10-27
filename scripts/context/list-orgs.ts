import prisma from '@/lib/db';

async function main() {
  const rows = await prisma.platformOrg.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: 'asc' },
  });
  console.log('platform_orgs:', rows);
  console.log('DEFAULT_ORG_SLUG env:', process.env.DEFAULT_ORG_SLUG ?? '(unset)');
}

main()
  .finally(() => prisma.$disconnect());
