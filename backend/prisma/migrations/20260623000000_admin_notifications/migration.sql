CREATE TYPE "NotificationTargetType" AS ENUM ('global', 'user');

CREATE TABLE "AdminNotification" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "targetType" "NotificationTargetType" NOT NULL DEFAULT 'global',
  "targetAccountId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationReceipt" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminNotification_active_targetType_createdAt_idx"
  ON "AdminNotification"("active", "targetType", "createdAt");

CREATE INDEX "AdminNotification_targetAccountId_idx"
  ON "AdminNotification"("targetAccountId");

CREATE UNIQUE INDEX "NotificationReceipt_notificationId_accountId_key"
  ON "NotificationReceipt"("notificationId", "accountId");

CREATE INDEX "NotificationReceipt_accountId_idx"
  ON "NotificationReceipt"("accountId");

ALTER TABLE "NotificationReceipt"
  ADD CONSTRAINT "NotificationReceipt_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationReceipt"
  ADD CONSTRAINT "NotificationReceipt_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
