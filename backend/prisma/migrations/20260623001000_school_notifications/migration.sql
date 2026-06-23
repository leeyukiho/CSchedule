ALTER TYPE "NotificationTargetType" ADD VALUE IF NOT EXISTS 'school';

ALTER TABLE "AdminNotification"
  ADD COLUMN IF NOT EXISTS "targetSchoolId" TEXT;

CREATE INDEX IF NOT EXISTS "AdminNotification_targetSchoolId_idx"
  ON "AdminNotification"("targetSchoolId");
