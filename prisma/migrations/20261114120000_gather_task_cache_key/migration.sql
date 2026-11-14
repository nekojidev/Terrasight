-- The history builder reads each source's result through the cache key its gather task produced (EP-02).
ALTER TABLE "gather_tasks" ADD COLUMN "cache_key" TEXT;
ALTER TABLE "gather_tasks" ADD COLUMN "data_date" DATE;
