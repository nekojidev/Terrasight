-- AI-written recommendation text and assistant-suggested watch-items (Product Definition v2.11). Additive.
ALTER TABLE "recommendations" ADD COLUMN "ai_text" JSONB;
ALTER TABLE "recommendations" ADD COLUMN "ai_suggested" BOOLEAN NOT NULL DEFAULT false;
