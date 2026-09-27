import type { PrismaClient } from "@prisma/client";
import { d1Boolean, d1Count, d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";
import { mapModel, type ColumnSpec } from "~/lib/d1-models.server";
import { promoteLegacyOAuthIssuerForUser } from "~/lib/oauth-server.server";
import { listUserPasskeys, type PasskeySummary } from "~/lib/webauthn-route.server";

// Reads behind the account settings page. The Prisma reader is the original sequence of
// queries; the D1 reader returns the same data in one batch.

export interface AccountSettingsReads {
  user: {
    id: string;
    email: string;
    username: string;
    hasPassword: boolean;
    photoUrl: string | null;
    OAuth: Array<{ provider: string; providerUsername: string }>;
  } | null;
  passkeys: PasskeySummary[];
  pushSubscriptionCount: number;
  preferences: {
    notifySpoonOnMyRecipe: boolean;
    notifyForkOfMyRecipe: boolean;
    notifyCookbookSaveOfMine: boolean;
    notifyFellowChefOriginCook: boolean;
  } | null;
  // Personal API tokens (not revoked, not issued to an OAuth client), newest first.
  apiCredentials: Array<{
    id: string;
    name: string;
    tokenPrefix: string;
    scopes: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
  }>;
  // Refresh tokens not revoked, newest first.
  activeRefreshTokens: Array<{
    clientId: string;
    id: string;
    issuer: string | null;
    resource: string | null;
    scope: string;
    createdAt: Date;
    connectionKey: string | null;
  }>;
  // The clients of those refresh tokens.
  oauthClients: Array<{ id: string; clientName: string | null }>;
  // Access tokens (not revoked) for those clients, counted per connection.
  accessCredentialCounts: Array<{
    oauthClientId: string | null;
    oauthIssuer: string | null;
    oauthResource: string | null;
    oauthConnectionKey: string | null;
    count: number;
  }>;
}

export async function readAccountSettingsWithPrisma(
  database: PrismaClient,
  userId: string,
  issuer: string,
): Promise<AccountSettingsReads> {
  await promoteLegacyOAuthIssuerForUser(database, userId, issuer);

  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      hashedPassword: true,
      photoUrl: true,
      OAuth: { select: { provider: true, providerUsername: true } },
    },
  });

  const passkeys = await listUserPasskeys(database, userId);
  const pushSubscriptionCount = await database.pushSubscription.count({ where: { userId } });
  const prefRow = await database.notificationPreference.findUnique({ where: { userId } });
  const apiCredentials = await database.apiCredential.findMany({
    where: { userId, revokedAt: null, oauthClientId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  const activeRefreshTokens = await database.oAuthRefreshToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { clientId: true, id: true, issuer: true, resource: true, scope: true, createdAt: true, connectionKey: true },
  });
  const oauthClientIds = [...new Set(activeRefreshTokens.map((token) => token.clientId))];
  const oauthClients = oauthClientIds.length
    ? await database.oAuthClient.findMany({
        where: { id: { in: oauthClientIds } },
        select: { id: true, clientName: true },
      })
    : [];
  const accessCredentialCounts = await database.apiCredential.groupBy({
    by: ["oauthClientId", "oauthIssuer", "oauthResource", "oauthConnectionKey"],
    where: {
      userId,
      revokedAt: null,
      oauthClientId: { in: oauthClientIds.length ? oauthClientIds : ["__none__"] },
    },
    _count: { _all: true },
  });

  return {
    user: user
      ? {
          id: user.id,
          email: user.email,
          username: user.username,
          hasPassword: user.hashedPassword !== null,
          photoUrl: user.photoUrl,
          OAuth: user.OAuth,
        }
      : null,
    passkeys,
    pushSubscriptionCount,
    preferences: prefRow
      ? {
          notifySpoonOnMyRecipe: prefRow.notifySpoonOnMyRecipe,
          notifyForkOfMyRecipe: prefRow.notifyForkOfMyRecipe,
          notifyCookbookSaveOfMine: prefRow.notifyCookbookSaveOfMine,
          notifyFellowChefOriginCook: prefRow.notifyFellowChefOriginCook,
        }
      : null,
    apiCredentials,
    activeRefreshTokens,
    oauthClients,
    accessCredentialCounts: accessCredentialCounts.map((row) => ({
      oauthClientId: row.oauthClientId,
      oauthIssuer: row.oauthIssuer,
      oauthResource: row.oauthResource,
      oauthConnectionKey: row.oauthConnectionKey,
      count: row._count._all,
    })),
  };
}

const USER_COLUMNS: ColumnSpec<{ id: string; email: string; username: string; photoUrl: string | null }> = {
  id: "string",
  email: "string",
  username: "string",
  photoUrl: "string?",
};

const OAUTH_ACCOUNT_COLUMNS: ColumnSpec<{ provider: string; providerUsername: string }> = {
  provider: "string",
  providerUsername: "string",
};

const PASSKEY_COLUMNS: ColumnSpec<PasskeySummary> = {
  id: "string",
  name: "string?",
  transports: "string?",
  createdAt: "dateTime?",
};

const PREFERENCE_COLUMNS: ColumnSpec<NonNullable<AccountSettingsReads["preferences"]>> = {
  notifySpoonOnMyRecipe: "boolean",
  notifyForkOfMyRecipe: "boolean",
  notifyCookbookSaveOfMine: "boolean",
  notifyFellowChefOriginCook: "boolean",
};

const API_CREDENTIAL_COLUMNS: ColumnSpec<AccountSettingsReads["apiCredentials"][number]> = {
  id: "string",
  name: "string",
  tokenPrefix: "string",
  scopes: "string",
  createdAt: "dateTime",
  lastUsedAt: "dateTime?",
  expiresAt: "dateTime?",
};

const REFRESH_TOKEN_COLUMNS: ColumnSpec<AccountSettingsReads["activeRefreshTokens"][number]> = {
  clientId: "string",
  id: "string",
  issuer: "string?",
  resource: "string?",
  scope: "string",
  createdAt: "dateTime",
  connectionKey: "string?",
};

const OAUTH_CLIENT_COLUMNS: ColumnSpec<AccountSettingsReads["oauthClients"][number]> = {
  id: "string",
  clientName: "string?",
};

const ACCESS_COUNT_COLUMNS: ColumnSpec<AccountSettingsReads["accessCredentialCounts"][number]> = {
  oauthClientId: "string?",
  oauthIssuer: "string?",
  oauthResource: "string?",
  oauthConnectionKey: "string?",
  count: "int",
};

// The clients the user holds an active refresh token for.
const ACTIVE_REFRESH_CLIENT_IDS = `SELECT "clientId" FROM "OAuthRefreshToken" WHERE "userId" = ? AND "revokedAt" IS NULL`;

/**
 * The account settings reads as one D1 batch, every statement scoped to the signed-in
 * user. Returns null when the user has OAuth rows from before issuers were recorded that
 * `promoteLegacyOAuthIssuerForUser` would promote to `issuer`: those need a write first,
 * so the caller uses the Prisma reader then. Legacy rows the promotion cannot change (their
 * client is missing or already bound to another issuer) do not count: for them the Prisma
 * path's promotion is a no-op, and this reader returns the same rows it would.
 */
export async function readAccountSettingsFromD1(
  db: D1ReadDatabase,
  userId: string,
  issuer: string,
): Promise<AccountSettingsReads | null> {
  const [
    legacyRows,
    userRows,
    oauthRows,
    passkeyRows,
    pushRows,
    preferenceRows,
    apiCredentialRows,
    refreshTokenRows,
    clientRows,
    accessCountRows,
  ] = await d1ReadBatch(db, [
    [
      // The rows promoteLegacyOAuthIssuerForUser would change: legacy tokens and access
      // credentials whose client is unbound or already bound to this issuer.
      `SELECT (
         EXISTS (
           SELECT 1 FROM "OAuthRefreshToken" t
           JOIN "OAuthClient" c ON c."id" = t."clientId"
           WHERE t."userId" = ? AND t."issuer" IS NULL AND (c."issuer" IS NULL OR c."issuer" = ?)
         )
         OR EXISTS (
           SELECT 1 FROM "ApiCredential" a
           JOIN "OAuthClient" c ON c."id" = a."oauthClientId"
           WHERE a."userId" = ? AND a."oauthIssuer" IS NULL AND (c."issuer" IS NULL OR c."issuer" = ?)
         )
       ) AS "needsIssuerPromotion"`,
      userId,
      issuer,
      userId,
      issuer,
    ],
    [
      `SELECT "id", "email", "username", "photoUrl", "hashedPassword" IS NOT NULL AS "hasPassword"
       FROM "User" WHERE "id" = ? LIMIT 1`,
      userId,
    ],
    [`SELECT "provider", "providerUsername" FROM "OAuth" WHERE "userId" IN (?)`, userId],
    [
      `SELECT "id", "name", "transports", "createdAt" FROM "UserCredential"
       WHERE "userId" = ? ORDER BY "createdAt" DESC, "id" DESC`,
      userId,
    ],
    [`SELECT COUNT(*) AS "count" FROM "PushSubscription" WHERE "userId" = ?`, userId],
    [
      `SELECT "notifySpoonOnMyRecipe", "notifyForkOfMyRecipe", "notifyCookbookSaveOfMine", "notifyFellowChefOriginCook"
       FROM "NotificationPreference" WHERE "userId" = ? LIMIT 1`,
      userId,
    ],
    [
      `SELECT "id", "name", "tokenPrefix", "scopes", "createdAt", "lastUsedAt", "expiresAt" FROM "ApiCredential"
       WHERE "userId" = ? AND "revokedAt" IS NULL AND "oauthClientId" IS NULL
       ORDER BY "createdAt" DESC, "id" DESC`,
      userId,
    ],
    [
      `SELECT "clientId", "id", "issuer", "resource", "scope", "createdAt", "connectionKey" FROM "OAuthRefreshToken"
       WHERE "userId" = ? AND "revokedAt" IS NULL
       ORDER BY "createdAt" DESC, "id" DESC`,
      userId,
    ],
    [`SELECT "id", "clientName" FROM "OAuthClient" WHERE "id" IN (${ACTIVE_REFRESH_CLIENT_IDS})`, userId],
    [
      `SELECT COUNT(*) AS "count", "oauthClientId", "oauthIssuer", "oauthResource", "oauthConnectionKey"
       FROM "ApiCredential"
       WHERE "userId" = ? AND "revokedAt" IS NULL AND "oauthClientId" IN (${ACTIVE_REFRESH_CLIENT_IDS})
       GROUP BY "oauthClientId", "oauthIssuer", "oauthResource", "oauthConnectionKey"`,
      userId,
      userId,
    ],
  ]);

  if (d1Boolean(legacyRows[0]?.needsIssuerPromotion, "needsIssuerPromotion")) {
    return null;
  }

  const userRow = userRows[0];
  const preferenceRow = preferenceRows[0];
  return {
    user: userRow
      ? {
          ...mapModel(USER_COLUMNS, userRow),
          hasPassword: d1Boolean(userRow.hasPassword, "hasPassword"),
          OAuth: oauthRows.map((row) => mapModel(OAUTH_ACCOUNT_COLUMNS, row)),
        }
      : null,
    passkeys: passkeyRows.map((row) => mapModel(PASSKEY_COLUMNS, row)),
    pushSubscriptionCount: d1Count(pushRows[0]?.count, "count"),
    preferences: preferenceRow ? mapModel(PREFERENCE_COLUMNS, preferenceRow) : null,
    apiCredentials: apiCredentialRows.map((row) => mapModel(API_CREDENTIAL_COLUMNS, row)),
    activeRefreshTokens: refreshTokenRows.map((row) => mapModel(REFRESH_TOKEN_COLUMNS, row)),
    oauthClients: clientRows.map((row) => mapModel(OAUTH_CLIENT_COLUMNS, row)),
    accessCredentialCounts: accessCountRows.map((row) => mapModel(ACCESS_COUNT_COLUMNS, row)),
  };
}
