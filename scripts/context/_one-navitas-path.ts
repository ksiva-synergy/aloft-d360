import prisma from '@/lib/db';
async function main() {
  const o = await prisma.platformContextObject.findFirst({
    where: {
      source_id: 'b491f1d6-944e-42d7-855b-dbd392bd7a3e',
      lifecycle: 'active',
      full_path: { startsWith: 'curated_db.db_smac_prod_navitasai_masters_public.' },
    },
    select: { full_path: true },
  });
  console.log(o?.full_path ?? 'none');
}
main().finally(() => prisma.$disconnect());
