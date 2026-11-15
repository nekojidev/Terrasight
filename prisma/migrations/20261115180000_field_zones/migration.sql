-- Rate-map zones (PD FR-ZN-1..3). Additive only: three new tables.

-- CreateTable
CREATE TABLE "field_zone_builds" (
    "field_id" UUID NOT NULL,
    "run_id" UUID,
    "status" TEXT NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "seasons" JSONB,
    "stats" JSONB,
    "params" JSONB,
    "ndvi_date" DATE,
    "ndvi_scene_id" TEXT,
    "ndvi_corners" JSONB,
    "ndvi_png" BYTEA,
    "ndvi_stats" JSONB,
    "ndvi_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_zone_builds_pkey" PRIMARY KEY ("field_id")
);

-- CreateTable
CREATE TABLE "field_zones" (
    "field_id" UUID NOT NULL,
    "zone" TEXT NOT NULL,
    "geom" geometry(MultiPolygon, 4326) NOT NULL,
    "area_ha" DOUBLE PRECISION NOT NULL,
    "share" DOUBLE PRECISION NOT NULL,
    "mean_percentile" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_zones_pkey" PRIMARY KEY ("field_id","zone"),
    CONSTRAINT "field_zones_zone_check" CHECK ("zone" IN ('strong', 'variable', 'weak'))
);

-- CreateTable
CREATE TABLE "field_zone_cache" (
    "geom_hash" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "res" INTEGER NOT NULL,
    "epsg" INTEGER NOT NULL,
    "x0" DOUBLE PRECISION NOT NULL,
    "y0" DOUBLE PRECISION NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "scenes" INTEGER NOT NULL,
    "listed" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_zone_cache_pkey" PRIMARY KEY ("geom_hash","season","res")
);

-- AddForeignKey
ALTER TABLE "field_zone_builds" ADD CONSTRAINT "field_zone_builds_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_zones" ADD CONSTRAINT "field_zones_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "field_zones_geom_gist" ON "field_zones" USING GIST ("geom");
