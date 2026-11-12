/**
 * simplified-model-migrate.ts: S2 copy from the current access tables into the simplified model's
 * tables (docs/access/simplified-access-model.md §5). Needs migration 20261108_simplified_access.
 * The mapping itself is src/lib/access/migrate-plan.ts (pure, tested).
 *
 * Default is a PLAN only (reads, prints, writes nothing). With --apply it INSERTS rows in one
 * transaction. It never updates or deletes, and is safe to re-run: every copied row records its source
 * (migrated_from_*), and sources already copied are skipped. Old tables are left untouched.
 *
 * Usage (repo root):
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/simplified-model-migrate.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/access/simplified-model-migrate.ts --apply --approver=someone@company.com
 */
import { prisma } from '@/lib/db';
import { bumpPolicyVersionInTx } from '@/lib/access/policy-store';
import { copyWouldOpenData, planCopy } from '@/lib/access/migrate-plan';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const approverEmail = args.find((a) => a.startsWith('--approver='))?.slice('--approver='.length);

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
  const [departments, departmentMembers, grants, labels, clearances, existingGroups, existingRules, existingTags, existingPP] = await Promise.all([
    prisma.accessDepartment.findMany({ where: { org_id: orgId } }),
    prisma.accessDepartmentMember.findMany({ where: { department: { org_id: orgId } } }),
    prisma.accessGrant.findMany({ where: { org_id: orgId } }),
    prisma.accessLabel.findMany({ where: { org_id: orgId } }),
    prisma.accessClearance.findMany({ where: { org_id: orgId } }),
    prisma.accessGroup.findMany({ where: { org_id: orgId } }),
    prisma.accessRule.findMany({ where: { org_id: orgId }, select: { migrated_from_grant_id: true } }),
    prisma.accessTag.findMany({ where: { org_id: orgId } }),
    prisma.accessPathProtection.findMany({ where: { org_id: orgId }, select: { migrated_from_label_id: true } }),
  ]);

  const current = { departments, departmentMembers, grants, labels, clearances };
  const plan = planCopy(current);
  if (copyWouldOpenData(current, plan)) {
    throw new Error('All existing grants are Discover-only; copying would leave no rules and open unprotected data. Add a Use rule first.');
  }

  const groupByDept = new Map(existingGroups.filter((g) => g.migrated_from_department_id).map((g) => [g.migrated_from_department_id!, g.id]));
  const doneGrants = new Set(existingRules.map((r) => r.migrated_from_grant_id).filter(Boolean));
  const doneLabels = new Set(existingPP.map((p) => p.migrated_from_label_id).filter(Boolean));
  const tagIdByKey = new Map(existingTags.map((t) => [t.key, t.id]));

  const groupsToCreate = plan.groups.filter((g) => !groupByDept.has(g.departmentId));
  const rulesToCreate = plan.rules.filter((r) => !doneGrants.has(r.grantId));
  const ppToCreate = plan.pathProtections.filter((p) => !doneLabels.has(p.labelId));
  const tagsToCreate = plan.tags.filter((t) => !tagIdByKey.has(t.key));

  console.log(`org ${orgId}`);
  for (const g of groupsToCreate) {
    console.log(`group      ${g.name} (from department ${g.key}; ${plan.members.filter((m) => m.group_id === g.id).length} member(s))`);
  }
  for (const r of rulesToCreate) {
    console.log(`rule       ${r.holder_type}:${r.holder_id} ${r.effect === 'block' ? 'Block' : r.allow_export ? 'Use + export' : 'Use'} on ${r.path}`);
  }
  for (const id of plan.droppedDiscoverGrantIds) console.log(`drop       discover grant ${id} (names are visible to everyone)`);
  for (const t of tagsToCreate) console.log(`protection ${t.name} (new)`);
  for (const p of ppToCreate) console.log(`protect    ${p.path} as ${p.tag_id.replace('label:', '')}`);
  for (const g of plan.tagGrants) console.log(`access     person ${g.principal_id} → ${g.tag_id.replace('label:', '')}`);
  if (!groupsToCreate.length && !rulesToCreate.length && !ppToCreate.length && !plan.tagGrants.length) {
    console.log('Nothing to copy (already migrated).');
  }

  if (!APPLY) {
    console.log('\nPlan only. Re-run with --apply --approver=<email> to write.');
    return;
  }
  if (!approverEmail) throw new Error('--approver=<email> is required with --apply (approver of the copied groups)');
  const approver = await prisma.user.findFirst({ where: { email: approverEmail, deletedAt: null }, select: { id: true } });
  if (!approver) throw new Error(`No active user with email ${approverEmail}`);

  const counts = { groups: 0, members: 0, rules: 0, tags: 0, pathProtections: 0, tagGrants: 0 };
  await prisma.$transaction(async (tx) => {
    const usedKeys = new Set(existingGroups.map((g) => g.key));
    const realGroupId = new Map<string, string>([...groupByDept].map(([deptId, gid]) => [`dept:${deptId}`, gid]));
    for (const g of groupsToCreate) {
      let key = g.key;
      for (let n = 2; usedKeys.has(key); n++) key = `${g.key}_${n}`;
      usedKeys.add(key);
      const row = await tx.accessGroup.create({
        data: { org_id: orgId, key, name: g.name, archived_at: g.archived_at, created_by: approver.id, migrated_from_department_id: g.departmentId },
      });
      await tx.accessGroupOwner.create({ data: { group_id: row.id, user_id: approver.id, added_by: approver.id } });
      realGroupId.set(g.id, row.id);
      counts.groups++;
      for (const m of plan.members.filter((x) => x.group_id === g.id)) {
        await tx.accessGroupMember.create({
          data: { group_id: row.id, user_id: m.user_id, reason: 'Copied from department', granted_by: approver.id },
        });
        counts.members++;
      }
    }

    const realTagId = new Map<string, string>();
    for (const t of plan.tags) {
      const existing = tagIdByKey.get(t.key);
      if (existing) {
        realTagId.set(t.id, existing);
        continue;
      }
      const row = await tx.accessTag.create({
        data: { org_id: orgId, key: t.key, name: t.name, description: `Copied from the ${t.name} label`, created_by: approver.id },
      });
      realTagId.set(t.id, row.id);
      counts.tags++;
    }

    for (const r of rulesToCreate) {
      const holderId = r.holder_type === 'group' ? realGroupId.get(r.holder_id) : r.holder_id;
      if (!holderId) throw new Error(`No group for ${r.holder_id}`);
      await tx.accessRule.create({
        data: {
          org_id: orgId,
          holder_type: r.holder_type,
          holder_id: holderId,
          path: r.path,
          path_depth: r.path_depth,
          effect: r.effect,
          allow_export: r.allow_export,
          expires_at: r.expires_at,
          reason: 'Copied from grant',
          created_by: approver.id,
          migrated_from_grant_id: r.grantId,
        },
      });
      counts.rules++;
    }

    for (const p of ppToCreate) {
      await tx.accessPathProtection.create({
        data: {
          org_id: orgId,
          tag_id: realTagId.get(p.tag_id)!,
          path: p.path,
          path_depth: p.path_depth,
          reason: 'Copied from label',
          set_by: approver.id,
          migrated_from_label_id: p.labelId,
        },
      });
      counts.pathProtections++;
    }

    for (const g of plan.tagGrants) {
      const tagId = realTagId.get(g.tag_id)!;
      const exists = await tx.accessTagGrant.findUnique({
        where: { tag_id_principal_type_principal_id: { tag_id: tagId, principal_type: 'user', principal_id: g.principal_id } },
      });
      if (exists) continue;
      await tx.accessTagGrant.create({
        data: {
          org_id: orgId,
          tag_id: tagId,
          principal_type: 'user',
          principal_id: g.principal_id,
          level: 'full',
          expires_at: g.expires_at,
          reason: 'Copied from clearance',
          created_by: approver.id,
        },
      });
      counts.tagGrants++;
    }

    await bumpPolicyVersionInTx(tx, orgId);
  });

  console.log(`\nApplied: ${JSON.stringify(counts)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
