-- Source of the tillage value on the season record (additive): a recommendation left as is stays `plan`.
ALTER TABLE "season_records" ADD COLUMN "tillage_source" "ValueSource" NOT NULL DEFAULT 'unknown';
UPDATE "season_records" SET "tillage_source" = 'confirmed' WHERE "tillage" IS NOT NULL;
