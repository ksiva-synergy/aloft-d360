-- Add AAD SSO support fields to User and LoginEvent tables

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authProvider" TEXT NOT NULL DEFAULT 'credentials';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LoginEvent" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'credentials';
