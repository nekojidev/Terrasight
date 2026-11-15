-- Owner decisions (PD v2.7): "ask the owner" is a separate, deliberate action. Additive only.
ALTER TABLE "recommendations" ADD COLUMN "ask_owner_at" TIMESTAMPTZ(3);
ALTER TABLE "recommendations" ADD COLUMN "ask_owner_by" UUID;
ALTER TABLE "recommendations" ADD COLUMN "ask_note" TEXT;
ALTER TABLE "recommendations" ADD COLUMN "ask_committed_at" TIMESTAMPTZ(3);
-- Who asked (author of the note in the decision thread).
ALTER TABLE "report_items" ADD COLUMN "asked_by" UUID;
