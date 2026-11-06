-- Allow data access grants to an app role (member, admin, readonly, …) as well as a
-- person or a department. Replaces the principal_type CHECK; no data changes.
ALTER TABLE "access_grants" DROP CONSTRAINT IF EXISTS "access_grants_principal_type_check";
ALTER TABLE "access_grants"
    ADD CONSTRAINT "access_grants_principal_type_check"
    CHECK ("principal_type" IN ('user', 'department', 'role'));
