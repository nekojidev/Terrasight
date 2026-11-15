-- Owner creates users (PD v2.9): an account can exist without a password until the one-time setup link is used.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "setup_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "setup_expires_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX IF NOT EXISTS "users_setup_token_hash_key" ON "users"("setup_token_hash");
