-- Email ownership. Every existing account starts unverified (NULL): nothing a user does today
-- depends on it, and the only behaviour it gates is linking a Google or GitHub sign-in to an
-- existing account by matching email, which now needs a verified address.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;

-- Single-use links sent by email: verify an address, confirm an email change, reset a password.
-- Only the SHA-256 of each token is stored; "email" is the address the link was sent to.
CREATE TABLE "AccountEmailToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountEmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountEmailToken_purpose_check" CHECK ("purpose" IN ('verify_email', 'change_email', 'reset_password'))
);
CREATE UNIQUE INDEX "AccountEmailToken_tokenHash_key" ON "AccountEmailToken"("tokenHash");
CREATE INDEX "AccountEmailToken_userId_purpose_createdAt_idx" ON "AccountEmailToken"("userId", "purpose", "createdAt");

-- QA only: with SPOONJOY_EMAIL_MODE=capture, messages are written here instead of being sent,
-- so journeys and proofs can follow the links without a real mailbox. Production never writes it.
CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "toAddress" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailOutbox_toAddress_createdAt_idx" ON "EmailOutbox"("toAddress", "createdAt");
