-- Email verification and password reset (additive). Existing users stay unverified until they verify.
ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "verify_token_hash" TEXT,
  ADD COLUMN "verify_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "reset_token_hash" TEXT,
  ADD COLUMN "reset_expires_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "users_verify_token_hash_key" ON "users"("verify_token_hash");
CREATE UNIQUE INDEX "users_reset_token_hash_key" ON "users"("reset_token_hash");
