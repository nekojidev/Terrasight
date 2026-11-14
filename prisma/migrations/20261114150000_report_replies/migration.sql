-- Agronomist replies to the owner on a report item (RFC §12.6, S-08.05); shown on the owner's report.
CREATE TABLE IF NOT EXISTS "report_replies" (
    "id" UUID NOT NULL,
    "report_item_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_replies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_replies_report_item_id_fkey" FOREIGN KEY ("report_item_id") REFERENCES "report_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "report_replies_report_item_id_created_at_idx" ON "report_replies"("report_item_id", "created_at");
