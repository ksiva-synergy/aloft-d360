/**
 * seed-data-departments.ts: turn today's groups-with-rules into departments (migration 20261109).
 *
 * For every active group that has Use rules, the plan is: one department with the group's key and name,
 * the group's Use-rule paths tagged as the department's data, and the group linked to it (Use, or
 * Use + export only when every one of its rules exports). Blocks stay as rules. Nothing is updated or
 * deleted: the group's old rules keep working next to the new department, so access cannot shrink.
 * Re-running skips departments that already exist (same key).
 *
 * Default is a PLAN only (reads, prints, writes nothing). With --apply it INSERTS in one transaction.
 *
 * Usage (repo root):
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/seed-data-departments.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/seed-data-departments.ts --apply
 */
import { prisma } from '@/lib/db';
import { bumpPolicyVersionInTx } from '@/lib/access/policy-store';
import { evictAccessModel } from '@/lib/access/model-store';

const APPLY = process.argv.slice(2).includes('--apply');
const REASON = 'Seeded from existing group rules';

async function resolveOrgId(): Promise<string> {
  const id = process.env.DEFAULT_ORG_ID?.trim();
  if (id) return id;
  const slug = process.env.DEFAULT_ORG_SLUG?.trim();
  const org = slug
    ? await prisma.platformOrg.findFirst({ where: { slug }, select: { id: true } })
    : await prisma.platformOrg.findFirst({ select: { id: true }, orderBy: { created_at: 'asc' } });
  if (!org) throw new Error('No org found (set DEFAULT_ORG_ID or DEFAULT_ORG_SLUG)');
  return org.id;
}

async function main() {
  const orgId = await resolveOrgId();
  const [groups, rules, existing] = await Promise.all([
    prisma.accessGroup.findMany({ where: { org_id: orgId, archived_at: null }, select: { id: true, key: true, name: true } }),
    prisma.accessRule.findMany({ where: { org_id: orgId, holder_type: 'group', effect: 'use' }, select: { holder_id: true, path: true, path_depth: true, allow_export: true } }),
    prisma.accessDataDepartment.findMany({ where: { org_id: orgId }, select: { key: true } }),
  ]);
  const taken = new Set(existing.map((d) => d.key));

  const plan = groups
    .map((g) => {
      const mine = rules.filter((r) => r.holder_id === g.id);
      return {
        group: g,
        paths: [...new Map(mine.map((r) => [r.path, r.path_depth])).entries()],
        allExport: mine.length > 0 && mine.every((r) => r.allow_export),
        mixed: mine.some((r) => r.allow_export) && !mine.every((r) => r.allow_export),
      };
    })
    .filter((p) => p.paths.length > 0);

  if (plan.length === 0) {
    console.log('Nothing to seed: no active group has a Use rule.');
    return;
  }
  for (const p of plan) {
    const skip = taken.has(p.group.key);
    console.log(`${skip ? 'SKIP (department exists)' : 'CREATE'} department "${p.group.name}" [${p.group.key}]`);
    for (const [path] of p.paths) console.log(`    owns   ${path}`);
    console.log(`    group  ${p.group.name} → ${p.allExport ? 'Use + export' : 'Use'}${p.mixed ? '  (WARNING: some rules export, some do not; linked as Use, review)' : ''}`);
  }
  if (!APPLY) {
    console.log('\nPlan only. Re-run with --apply to insert these rows.');
    return;
  }

  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      if (taken.has(p.group.key)) continue;
      const dept = await tx.accessDataDepartment.create({ data: { org_id: orgId, key: p.group.key, name: p.group.name, created_by: null } });
      for (const [path, depth] of p.paths) {
        await tx.accessDepartmentPath.create({ data: { org_id: orgId, department_id: dept.id, path, path_depth: depth, reason: REASON } });
      }
      await tx.accessDepartmentGroup.create({ data: { department_id: dept.id, group_id: p.group.id, allow_export: p.allExport } });
      created++;
    }
    if (created > 0) await bumpPolicyVersionInTx(tx, orgId);
  });
  evictAccessModel(orgId);
  console.log(`\nCreated ${created} department${created === 1 ? '' : 's'}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
