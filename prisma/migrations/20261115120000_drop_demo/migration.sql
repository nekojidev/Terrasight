-- No demo company in the product (2026-11-15): only real data. Existing workspaces are kept as ordinary ones.
ALTER TABLE "workspaces" DROP COLUMN "is_demo";
ALTER TABLE "workspaces" DROP COLUMN "demo_template_id";
