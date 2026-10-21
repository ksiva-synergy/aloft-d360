# Changelog

## 2026-10-21 — SSO-only authentication

- Removed the local admin email/password form from `src/app/login/page.tsx`; Microsoft SSO is now the only login option shown.
- Removed the NextAuth credentials provider and restricted interactive sign-in callbacks to Azure AD in `src/lib/auth.ts`.
- Updated user creation in `src/app/api/users/route.ts` and `src/components/users/InviteUserModal.tsx` to create SSO accounts without local passwords.
- Updated the authentication middleware documentation in `src/middleware/auth.ts`.
- Verification: `npm run typecheck`, `npm run build`, and IDE lint diagnostics.
- Deploy: merged to `Synergy-Marine-Group/aloft-d360` `main` (commit `00c507d` on branch; merge commit on `main`) to trigger **Build, push ECR, deploy Beanstalk** GitHub Actions.
- Not done: existing password hashes and legacy credential-provider labels in the database were not migrated or deleted. Did not push to `DATA360Portal_ReactJS` (separate legacy React portal repo).
