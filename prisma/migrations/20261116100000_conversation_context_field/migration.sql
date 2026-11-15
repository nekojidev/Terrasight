-- Which field a chat was opened from (additive), so the field panel can restore its thread.
ALTER TABLE "conversations" ADD COLUMN "context_field_id" UUID;
CREATE INDEX "conversations_ctx_field_idx"
  ON "conversations"("workspace_id", "user_id", "context_field_id", "created_at");
