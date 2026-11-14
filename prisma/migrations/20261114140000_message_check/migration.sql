-- Assistant messages (Tech Design §12.1): how many numbers were checked, the fallback card, the page context and
-- why a turn failed ("Assistant unavailable").
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "numbers_checked" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "card" JSONB;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "context" JSONB;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "error" TEXT;
