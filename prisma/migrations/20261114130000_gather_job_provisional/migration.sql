-- Set once when the provisional history was queued, claimed under a row lock (Tech Design §8.1).
ALTER TABLE "gather_jobs" ADD COLUMN IF NOT EXISTS "provisional_at" TIMESTAMPTZ(3);
