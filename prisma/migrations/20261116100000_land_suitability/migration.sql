-- Land suitability per field (additive, nullable): the computed check and the agronomist override.
ALTER TABLE "fields" ADD COLUMN "suitability" JSONB;
ALTER TABLE "fields" ADD COLUMN "suitability_override" JSONB;
