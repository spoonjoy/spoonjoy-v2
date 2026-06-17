CREATE TABLE "NativePushDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "deviceName" TEXT,
  "appVersion" TEXT,
  "enabledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TEXT,
  "lastRegisteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativePushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NativePushDevice_userId_deviceId_platform_environment_key" ON "NativePushDevice"("userId", "deviceId", "platform", "environment");
CREATE INDEX "NativePushDevice_userId_idx" ON "NativePushDevice"("userId");
CREATE INDEX "NativePushDevice_tokenHash_idx" ON "NativePushDevice"("tokenHash");
CREATE INDEX "NativePushDevice_userId_platform_environment_idx" ON "NativePushDevice"("userId", "platform", "environment");
