-- One user = one company (PD v2.12). DESTRUCTIVE: the invitation feature is removed, so its table is dropped
-- (pending and accepted invitations are lost), and the email-verification columns (which only guarded invitation
-- acceptance) are dropped with it. Password reset columns stay. Not applied to the shared database by the change
-- that added it; it runs with the normal deploy (`prisma migrate deploy`).
DROP TABLE "invitations";

DROP INDEX IF EXISTS "users_verify_token_hash_key";
ALTER TABLE "users"
  DROP COLUMN "email_verified_at",
  DROP COLUMN "verify_token_hash",
  DROP COLUMN "verify_expires_at";
