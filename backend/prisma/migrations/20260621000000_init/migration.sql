-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SchoolStatus" AS ENUM ('catalog_only', 'candidate', 'researching', 'beta', 'enabled', 'disabled');

-- CreateEnum
CREATE TYPE "LoginMode" AS ENUM ('direct_password', 'password_captcha', 'cas_simple', 'cas_webview', 'oauth_webview', 'qrcode');

-- CreateEnum
CREATE TYPE "DataAccessMode" AS ENUM ('cloud_worker', 'webview_client_fetch', 'session_import', 'manual_import');

-- CreateEnum
CREATE TYPE "DataTarget" AS ENUM ('course', 'score', 'exam', 'profile');

-- CreateEnum
CREATE TYPE "CredentialSaveMode" AS ENUM ('none', 'session_only', 'session_refresh', 'password_vault');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'need_login', 'cached_only', 'disabled', 'unbound');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('pending', 'running', 'success', 'failed', 'need_login', 'need_webview_fetch', 'rate_limited', 'cancelled');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('daily_course', 'exam');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('enabled', 'disabled', 'blocked');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('pending', 'skipped', 'sent', 'failed');

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "province" TEXT,
    "city" TEXT,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "providerId" TEXT,
    "loginMode" "LoginMode",
    "dataAccess" JSONB,
    "featureCapabilities" JSONB,
    "eduSystemType" TEXT,
    "homepageUrl" TEXT,
    "authUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "SchoolStatus" NOT NULL DEFAULT 'catalog_only',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "studentNoEncrypted" TEXT,
    "studentNoHash" TEXT,
    "displayName" TEXT,
    "wechatOpenid" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'unbound',
    "authState" JSONB,
    "cacheState" JSONB,
    "sessionReusable" BOOLEAN NOT NULL DEFAULT false,
    "sessionRefreshable" BOOLEAN NOT NULL DEFAULT false,
    "sessionExpireAt" TIMESTAMP(3),
    "lastSessionValidatedAt" TIMESTAMP(3),
    "credentialSaveMode" "CredentialSaveMode" NOT NULL DEFAULT 'none',
    "lastAuthErrorCode" TEXT,
    "lastAuthErrorAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastCachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCache" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "termId" TEXT,
    "coursesJson" JSONB NOT NULL,
    "termsJson" JSONB NOT NULL,
    "sectionTimesJson" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureCache" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "target" "DataTarget" NOT NULL,
    "termId" TEXT,
    "dataJson" JSONB NOT NULL,
    "metaJson" JSONB,
    "sourceHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "target" "DataTarget" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "openid" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'enabled',
    "templateId" TEXT,
    "preferredTime" TEXT NOT NULL DEFAULT '07:30',
    "timezoneOffsetMinutes" INTEGER NOT NULL DEFAULT 480,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastSentDate" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReminderDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "accountId" TEXT NOT NULL,
    "openid" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "dateKey" TEXT NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT,
    "summary" TEXT,
    "requestJson" JSONB,
    "responseJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "schoolId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'experience',
    "content" TEXT NOT NULL,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAccessSubmission" (
    "id" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "province" TEXT,
    "city" TEXT,
    "officialWebsite" TEXT,
    "eduSystemWebsite" TEXT,
    "loginUrl" TEXT,
    "loginModeHint" "LoginMode",
    "requestedTargets" "DataTarget"[] DEFAULT ARRAY[]::"DataTarget"[],
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "note" TEXT,
    "review" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAccessSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "School_name_idx" ON "School"("name");

-- CreateIndex
CREATE INDEX "School_providerId_idx" ON "School"("providerId");

-- CreateIndex
CREATE INDEX "StudentAccount_schoolId_idx" ON "StudentAccount"("schoolId");

-- CreateIndex
CREATE INDEX "StudentAccount_providerId_idx" ON "StudentAccount"("providerId");

-- CreateIndex
CREATE INDEX "StudentAccount_wechatOpenid_idx" ON "StudentAccount"("wechatOpenid");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAccount_schoolId_studentNoHash_key" ON "StudentAccount"("schoolId", "studentNoHash");

-- CreateIndex
CREATE INDEX "CourseCache_accountId_idx" ON "CourseCache"("accountId");

-- CreateIndex
CREATE INDEX "CourseCache_schoolId_idx" ON "CourseCache"("schoolId");

-- CreateIndex
CREATE INDEX "CourseCache_accountId_termId_syncedAt_idx" ON "CourseCache"("accountId", "termId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCache_accountId_sourceHash_key" ON "CourseCache"("accountId", "sourceHash");

-- CreateIndex
CREATE INDEX "FeatureCache_accountId_idx" ON "FeatureCache"("accountId");

-- CreateIndex
CREATE INDEX "FeatureCache_target_idx" ON "FeatureCache"("target");

-- CreateIndex
CREATE INDEX "FeatureCache_accountId_target_termId_syncedAt_idx" ON "FeatureCache"("accountId", "target", "termId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureCache_accountId_target_sourceHash_key" ON "FeatureCache"("accountId", "target", "sourceHash");

-- CreateIndex
CREATE INDEX "SyncRecord_accountId_idx" ON "SyncRecord"("accountId");

-- CreateIndex
CREATE INDEX "SyncRecord_status_idx" ON "SyncRecord"("status");

-- CreateIndex
CREATE INDEX "SyncRecord_accountId_target_status_createdAt_idx" ON "SyncRecord"("accountId", "target", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRecord_schoolId_target_status_createdAt_idx" ON "SyncRecord"("schoolId", "target", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReminderSubscription_status_type_preferredTime_idx" ON "ReminderSubscription"("status", "type", "preferredTime");

-- CreateIndex
CREATE INDEX "ReminderSubscription_lastSentDate_idx" ON "ReminderSubscription"("lastSentDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSubscription_accountId_openid_type_key" ON "ReminderSubscription"("accountId", "openid", "type");

-- CreateIndex
CREATE INDEX "ReminderDelivery_accountId_idx" ON "ReminderDelivery"("accountId");

-- CreateIndex
CREATE INDEX "ReminderDelivery_type_dateKey_status_idx" ON "ReminderDelivery"("type", "dateKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_subscriptionId_dateKey_key" ON "ReminderDelivery"("subscriptionId", "dateKey");

-- CreateIndex
CREATE INDEX "FeedbackItem_accountId_idx" ON "FeedbackItem"("accountId");

-- CreateIndex
CREATE INDEX "FeedbackItem_status_idx" ON "FeedbackItem"("status");

-- CreateIndex
CREATE INDEX "SchoolAccessSubmission_status_idx" ON "SchoolAccessSubmission"("status");

-- AddForeignKey
ALTER TABLE "StudentAccount" ADD CONSTRAINT "StudentAccount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCache" ADD CONSTRAINT "CourseCache_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureCache" ADD CONSTRAINT "FeatureCache_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRecord" ADD CONSTRAINT "SyncRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSubscription" ADD CONSTRAINT "ReminderSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ReminderSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
