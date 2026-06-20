WITH ranked_active_sync AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "accountId", "target"
      ORDER BY COALESCE("startedAt", "createdAt") DESC, "createdAt" DESC, "id" DESC
    ) AS row_number
  FROM "SyncRecord"
  WHERE "status" IN ('pending', 'running')
)
UPDATE "SyncRecord"
SET
  "status" = 'cancelled',
  "errorCode" = 'DUPLICATE_SYNC_JOB',
  "errorMessage" = 'Cancelled duplicate active sync job before active-sync unique index',
  "finishedAt" = COALESCE("finishedAt", CURRENT_TIMESTAMP)
FROM ranked_active_sync
WHERE "SyncRecord"."id" = ranked_active_sync."id"
  AND ranked_active_sync.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SyncRecord_active_account_target_key"
  ON "SyncRecord"("accountId", "target")
  WHERE "status" IN ('pending', 'running');

ALTER TABLE "School" DROP COLUMN IF EXISTS "featureCapabilities";
