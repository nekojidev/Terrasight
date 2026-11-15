-- Two roles (PD v2.10): Owner and Agronomist.
-- viewer -> owner (viewers were the farm owners who read and answer decisions);
-- admin  -> owner (keeps their management rights). Done in memberships and invitations, then the enum
-- is recreated without admin / viewer.
CREATE TYPE "Role_new" AS ENUM ('owner', 'agronomist');

ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text WHEN 'admin' THEN 'owner' WHEN 'viewer' THEN 'owner' ELSE "role"::text END)::"Role_new";
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text WHEN 'admin' THEN 'owner' WHEN 'viewer' THEN 'owner' ELSE "role"::text END)::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
