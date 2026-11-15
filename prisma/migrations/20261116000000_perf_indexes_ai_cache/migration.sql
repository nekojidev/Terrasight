-- Additive: indexes for the hot read paths, AI cost tables, cached field thumbnails, zone rasters in object storage.
-- Already covered, so not added: crop_seasons (field_id) is the leading column of its primary key.

CREATE INDEX IF NOT EXISTS "recommendations_field_id_status_idx" ON "recommendations"("field_id", "status");
CREATE INDEX IF NOT EXISTS "recommendations_workspace_id_field_id_status_idx" ON "recommendations"("workspace_id", "field_id", "status");
CREATE INDEX IF NOT EXISTS "analysis_run_fields_field_id_updated_at_idx" ON "analysis_run_fields"("field_id", "updated_at");
CREATE INDEX IF NOT EXISTS "gather_jobs_field_id_started_at_idx" ON "gather_jobs"("field_id", "started_at");
CREATE INDEX IF NOT EXISTS "plans_field_id_saved_at_idx" ON "plans"("field_id", "saved_at");
CREATE INDEX IF NOT EXISTS "scouting_tasks_field_id_idx" ON "scouting_tasks"("field_id");
CREATE INDEX IF NOT EXISTS "scouting_tasks_recommendation_id_idx" ON "scouting_tasks"("recommendation_id");
CREATE INDEX IF NOT EXISTS "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "source_cache_expires_at_idx" ON "source_cache"("expires_at");
CREATE INDEX IF NOT EXISTS "analysis_runs_workspace_id_trigger_as_of_idx" ON "analysis_runs"("workspace_id", "trigger", "as_of");
CREATE INDEX IF NOT EXISTS "scouting_photos_task_id_idx" ON "scouting_photos"("task_id");
-- Partial: the unread badge and "mark all read" only touch unread rows. Prisma cannot express the WHERE; schema.prisma omits it.
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications"("workspace_id", "user_id") WHERE "read_at" IS NULL;
-- Retention scans.
CREATE INDEX IF NOT EXISTS "input_snapshots_created_at_idx" ON "input_snapshots"("created_at");
CREATE INDEX IF NOT EXISTS "recommendation_levels_at_idx" ON "recommendation_levels"("at");
CREATE INDEX IF NOT EXISTS "analysis_run_fields_updated_at_idx" ON "analysis_run_fields"("updated_at");
CREATE INDEX IF NOT EXISTS "recommendations_input_snapshot_id_idx" ON "recommendations"("input_snapshot_id");
CREATE INDEX IF NOT EXISTS "notifications_read_at_idx" ON "notifications"("read_at") WHERE "read_at" IS NOT NULL;

-- AI rotation proposals (7-day TTL) and the per-day Gemini counter (used when Redis is not available).
CREATE TABLE "ai_rotation_proposals" (
    "context_hash" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_rotation_proposals_pkey" PRIMARY KEY ("context_hash","engine_version","model")
);
CREATE INDEX "ai_rotation_proposals_expires_at_idx" ON "ai_rotation_proposals"("expires_at");

CREATE TABLE "ai_usage" (
    "day" DATE NOT NULL,
    "tokens" BIGINT NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("day")
);

-- Field thumbnails: computed once when the geometry is written, not per request.
ALTER TABLE "fields" ADD COLUMN "thumb_geojson" TEXT;
CREATE FUNCTION fields_set_thumb() RETURNS trigger AS $$
BEGIN
  NEW.thumb_geojson := ST_AsGeoJSON(
    ST_SimplifyPreserveTopology(NEW.geom, GREATEST(ST_XMax(NEW.geom) - ST_XMin(NEW.geom), ST_YMax(NEW.geom) - ST_YMin(NEW.geom)) / 40), 6);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fields_set_thumb BEFORE INSERT OR UPDATE OF geom ON "fields"
  FOR EACH ROW EXECUTE FUNCTION fields_set_thumb();
UPDATE "fields" SET "geom" = "geom";

-- Zone rasters: bytes move to object storage when S3_BUCKET is set; the rows stay as metadata.
ALTER TABLE "field_zone_cache" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "field_zone_cache" ADD COLUMN "data_key" TEXT;
ALTER TABLE "field_zone_builds" ADD COLUMN "ndvi_png_key" TEXT;
