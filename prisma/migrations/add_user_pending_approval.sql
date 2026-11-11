-- Add PENDING_APPROVAL for SSO users awaiting platform-admin admission.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
