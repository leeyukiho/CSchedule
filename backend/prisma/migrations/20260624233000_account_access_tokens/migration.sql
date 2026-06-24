CREATE TABLE IF NOT EXISTS "AccountAccessToken" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountAccessToken_tokenHash_key"
  ON "AccountAccessToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "AccountAccessToken_accountId_idx"
  ON "AccountAccessToken"("accountId");

CREATE INDEX IF NOT EXISTS "AccountAccessToken_revokedAt_expiresAt_idx"
  ON "AccountAccessToken"("revokedAt", "expiresAt");

ALTER TABLE "AccountAccessToken"
  ADD CONSTRAINT "AccountAccessToken_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "StudentAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
