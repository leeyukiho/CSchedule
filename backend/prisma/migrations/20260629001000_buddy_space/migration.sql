CREATE TYPE "BuddyInviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

CREATE TABLE IF NOT EXISTS "BuddyInvite" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "inviterAccountId" TEXT NOT NULL,
  "inviteeAccountId" TEXT,
  "status" "BuddyInviteStatus" NOT NULL DEFAULT 'pending',
  "acceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BuddyInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BuddyLink" (
  "id" TEXT NOT NULL,
  "ownerAccountId" TEXT NOT NULL,
  "partnerAccountId" TEXT NOT NULL,
  "inviteId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BuddyLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BuddyInvite_code_key"
  ON "BuddyInvite"("code");

CREATE INDEX IF NOT EXISTS "BuddyInvite_inviterAccountId_idx"
  ON "BuddyInvite"("inviterAccountId");

CREATE INDEX IF NOT EXISTS "BuddyInvite_inviteeAccountId_idx"
  ON "BuddyInvite"("inviteeAccountId");

CREATE INDEX IF NOT EXISTS "BuddyInvite_status_expiresAt_idx"
  ON "BuddyInvite"("status", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "BuddyLink_ownerAccountId_partnerAccountId_key"
  ON "BuddyLink"("ownerAccountId", "partnerAccountId");

CREATE INDEX IF NOT EXISTS "BuddyLink_ownerAccountId_active_idx"
  ON "BuddyLink"("ownerAccountId", "active");

CREATE INDEX IF NOT EXISTS "BuddyLink_partnerAccountId_idx"
  ON "BuddyLink"("partnerAccountId");

CREATE INDEX IF NOT EXISTS "BuddyLink_inviteId_idx"
  ON "BuddyLink"("inviteId");

ALTER TABLE "BuddyInvite"
  ADD CONSTRAINT "BuddyInvite_inviterAccountId_fkey"
  FOREIGN KEY ("inviterAccountId") REFERENCES "StudentAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuddyInvite"
  ADD CONSTRAINT "BuddyInvite_inviteeAccountId_fkey"
  FOREIGN KEY ("inviteeAccountId") REFERENCES "StudentAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BuddyLink"
  ADD CONSTRAINT "BuddyLink_ownerAccountId_fkey"
  FOREIGN KEY ("ownerAccountId") REFERENCES "StudentAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuddyLink"
  ADD CONSTRAINT "BuddyLink_partnerAccountId_fkey"
  FOREIGN KEY ("partnerAccountId") REFERENCES "StudentAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
