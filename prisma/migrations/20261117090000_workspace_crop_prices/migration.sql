-- Additive: the company's own crop prices and costs (user data). No existing table changes.
CREATE TABLE "workspace_crop_prices" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "crop" TEXT NOT NULL,
    "price_per_t" DOUBLE PRECISION NOT NULL,
    "variable_cost_per_ha" DOUBLE PRECISION NOT NULL,
    "yield_ref_t_ha" DOUBLE PRECISION,
    "irrigated" BOOLEAN,
    "currency" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_crop_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_crop_prices_price_check" CHECK ("price_per_t" > 0),
    CONSTRAINT "workspace_crop_prices_cost_check" CHECK ("variable_cost_per_ha" >= 0),
    CONSTRAINT "workspace_crop_prices_yield_check" CHECK ("yield_ref_t_ha" IS NULL OR "yield_ref_t_ha" > 0)
);

CREATE INDEX "workspace_crop_prices_workspace_id_idx" ON "workspace_crop_prices"("workspace_id");
-- One row per crop and irrigation kind (NULL = any); a plain unique index would treat NULLs as distinct.
-- Prisma cannot express the expression, so schema.prisma omits it.
CREATE UNIQUE INDEX "workspace_crop_prices_key" ON "workspace_crop_prices"("workspace_id", "crop", COALESCE("irrigated"::text, 'any'));

ALTER TABLE "workspace_crop_prices" ADD CONSTRAINT "workspace_crop_prices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
