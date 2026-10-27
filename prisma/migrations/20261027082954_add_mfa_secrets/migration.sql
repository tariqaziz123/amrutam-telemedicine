-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_pending_secret" VARCHAR(512),
ADD COLUMN     "mfa_secret" VARCHAR(512);
