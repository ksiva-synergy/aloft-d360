-- Migration: RBAC Roles Overhaul
-- Renames admin → platform_admin, viewer → readonly, adds new scoped admin role,
-- adds new permissions (session:read:all, inspector:use), and migrates user role assignments.
-- Safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING).

BEGIN;

-- ── 1. Add new permissions ────────────────────────────────────────────────────

INSERT INTO permissions (id, key, description, created_at)
VALUES
  (gen_random_uuid(), 'session:read:all', 'View ALL users'' sessions and history (platform admin only)', NOW()),
  (gen_random_uuid(), 'inspector:use',    'Interact with the inspector (create sessions, run queries)',  NOW())
ON CONFLICT (key) DO NOTHING;

-- ── 2. Rename admin → platform_admin ─────────────────────────────────────────

UPDATE roles
SET name        = 'platform_admin',
    description = 'Full access including cross-user data visibility',
    updated_at  = NOW()
WHERE name = 'admin'
  AND is_system = TRUE;

-- Grant session:read:all to platform_admin (the renamed role)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'platform_admin'
  AND p.key IN ('session:read:all', 'inspector:use')
ON CONFLICT DO NOTHING;

-- ── 3. Rename viewer → readonly ───────────────────────────────────────────────

UPDATE roles
SET name        = 'readonly',
    description = 'Login and view only — no write interactions',
    updated_at  = NOW()
WHERE name = 'viewer'
  AND is_system = TRUE;

-- Remove session:write from readonly (viewer had none, so this is a no-op guard)
DELETE FROM role_permissions
WHERE role_id  = (SELECT id FROM roles WHERE name = 'readonly')
  AND permission_id = (SELECT id FROM permissions WHERE key = 'session:write');

-- ── 4. Insert new scoped admin role ──────────────────────────────────────────

INSERT INTO roles (id, name, description, is_system, created_at, updated_at)
VALUES (gen_random_uuid(), 'admin', 'All app actions scoped to own data only', TRUE, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- Grant permissions to the new admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.key IN (
    'user:read', 'user:create', 'user:update', 'user:delete',
    'role:read', 'role:assign',
    'session:read', 'session:write',
    'inspector:use',
    'audit:read'
  )
ON CONFLICT DO NOTHING;

-- ── 5. Grant inspector:use to member ──────────────────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'member'
  AND p.key = 'inspector:use'
ON CONFLICT DO NOTHING;

-- ── 6. Ensure readonly has only read-only permissions ─────────────────────────

-- Remove any write permissions that may have been on viewer/readonly
DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'readonly')
  AND permission_id IN (
    SELECT id FROM permissions WHERE key IN ('session:write', 'inspector:use', 'user:create', 'user:update', 'user:delete', 'role:assign')
  );

-- Ensure readonly has the correct baseline (user:read, session:read)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'readonly'
  AND p.key IN ('user:read', 'role:read', 'session:read', 'audit:read')
ON CONFLICT DO NOTHING;

COMMIT;
