import type { ApiCredential, NativePushDevice, PrismaClient as PrismaClientType } from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferenceFlags,
} from "~/lib/account-settings.server";
import { expandCredentialScopes } from "~/lib/api-auth.server";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import {
  deleteStoredImage,
  hasUploadedImageFile,
  storeImage,
  validateImageFile,
} from "~/lib/image-storage.server";
import { PROFILE_IMAGE_TYPES } from "~/lib/recipe-image";
import { listUserPasskeys } from "~/lib/webauthn-route.server";

type Database = PrismaClientType;
type NotificationPreferenceRow = {
  notifySpoonOnMyRecipe: boolean;
  notifyForkOfMyRecipe: boolean;
  notifyCookbookSaveOfMine: boolean;
  notifyFellowChefOriginCook: boolean;
} | null;

export type ApiV1AccountResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

const NOTIFICATION_KEYS = [
  "notifySpoonOnMyRecipe",
  "notifyForkOfMyRecipe",
  "notifyCookbookSaveOfMine",
  "notifyFellowChefOriginCook",
] as const satisfies readonly (keyof NotificationPreferenceFlags)[];

const APNS_FIELDS = [
  "deviceId",
  "platform",
  "environment",
  "token",
  "deviceName",
  "appVersion",
] as const;

const NATIVE_PLATFORMS = new Set(["ios", "ipados", "macos"]);
const APNS_ENVIRONMENTS = new Set(["development", "production"]);

function success<T>(data: T, status = 200): ApiV1AccountResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1AccountResult<T> {
  return { ok: false, code, message, details };
}

function credentialMetadata(credential: ApiCredential) {
  return {
    id: credential.id,
    name: credential.name,
    tokenPrefix: credential.tokenPrefix,
    scopes: expandCredentialScopes(credential.scopes),
    createdAt: credential.createdAt.toISOString(),
    updatedAt: credential.updatedAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    expiresAt: credential.expiresAt?.toISOString() ?? null,
  };
}

function notificationPreferenceFlags(prefRow: NotificationPreferenceRow): NotificationPreferenceFlags {
  return prefRow
    ? {
        notifySpoonOnMyRecipe: prefRow.notifySpoonOnMyRecipe,
        notifyForkOfMyRecipe: prefRow.notifyForkOfMyRecipe,
        notifyCookbookSaveOfMine: prefRow.notifyCookbookSaveOfMine,
        notifyFellowChefOriginCook: prefRow.notifyFellowChefOriginCook,
      }
    : DEFAULT_NOTIFICATION_PREFERENCES;
}

function textToBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToText(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

export function nativeConnectionIdFor(clientId: string, resource: string | null): string {
  return `oauth_${textToBase64Url(JSON.stringify({ clientId, resource }))}`;
}

function parseNativeConnectionId(connectionId: string): { clientId: string; resource: string | null } | null {
  if (!connectionId.startsWith("oauth_")) return null;
  try {
    const parsed = JSON.parse(base64UrlToText(connectionId.slice("oauth_".length))) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { clientId?: unknown }).clientId === "string" &&
      (
        (parsed as { resource?: unknown }).resource === null ||
        typeof (parsed as { resource?: unknown }).resource === "string"
      )
    ) {
      return {
        clientId: (parsed as { clientId: string }).clientId,
        resource: (parsed as { resource: string | null }).resource,
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function loadOAuthConnections(db: Database, userId: string) {
  const activeRefreshTokens = await db.oAuthRefreshToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      clientId: true,
      resource: true,
      scope: true,
      createdAt: true,
    },
  });
  const oauthClientIds = [...new Set(activeRefreshTokens.map((token) => token.clientId))];
  const oauthClients = oauthClientIds.length
    ? await db.oAuthClient.findMany({
        where: { id: { in: oauthClientIds } },
        select: { id: true, clientName: true },
      })
    : [];
  const clientNames = new Map(oauthClients.map((client) => [client.id, client.clientName]));
  const accessCredentialCounts = await db.apiCredential.groupBy({
    by: ["oauthClientId", "oauthResource"],
    where: {
      userId,
      revokedAt: null,
      oauthClientId: { in: oauthClientIds.length ? oauthClientIds : ["__none__"] },
    },
    _count: { _all: true },
  });
  const accessCounts = new Map(
    accessCredentialCounts.map((row) => [
      `${row.oauthClientId!}\u0000${row.oauthResource ?? ""}`,
      row._count._all,
    ]),
  );
  const groups = new Map<string, {
    clientId: string;
    clientName: string | null;
    resource: string | null;
    scopes: Set<string>;
    createdAt: Date;
    refreshTokenCount: number;
    accessTokenCount: number;
  }>();

  for (const token of activeRefreshTokens) {
    const key = `${token.clientId}\u0000${token.resource ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      for (const scope of token.scope.trim().split(/\s+/).filter(Boolean)) existing.scopes.add(scope);
      existing.refreshTokenCount += 1;
      continue;
    }
    groups.set(key, {
      clientId: token.clientId,
      clientName: clientNames.get(token.clientId) ?? null,
      resource: token.resource,
      scopes: new Set(token.scope.trim().split(/\s+/).filter(Boolean)),
      createdAt: token.createdAt,
      refreshTokenCount: 1,
      accessTokenCount: accessCounts.get(key) ?? 0,
    });
  }

  return Array.from(groups.values()).map((connection) => ({
    id: nativeConnectionIdFor(connection.clientId, connection.resource),
    clientId: connection.clientId,
    clientName: connection.clientName,
    resource: connection.resource,
    scopes: Array.from(connection.scopes).sort(),
    createdAt: connection.createdAt.toISOString(),
    refreshTokenCount: connection.refreshTokenCount,
    accessTokenCount: connection.accessTokenCount,
  }));
}

function accountHandoffs(input: {
  hasPassword: boolean;
  oauthAccountCount: number;
  passkeyCount: number;
}) {
  const canRemovePassword = input.oauthAccountCount > 0 || input.passkeyCount > 0;
  const canRemovePasskey = input.hasPassword || input.oauthAccountCount > 0 || input.passkeyCount > 1;
  const passwordActions = input.hasPassword
    ? ["changePassword", ...(canRemovePassword ? ["removePassword"] : [])]
    : ["setPassword"];
  const passkeyActions = ["addPasskey", "renamePasskey", ...(canRemovePasskey ? ["removePasskey"] : [])];

  return {
    accountSettings: { method: "GET", url: "/account/settings", onlineOnly: true },
    password: {
      method: "GET",
      url: "/account/settings",
      onlineOnly: true,
      actions: passwordActions,
    },
    passkeys: {
      method: "GET",
      url: "/account/settings",
      onlineOnly: true,
      registrationOptionsUrl: "/auth/webauthn/register/options",
      registrationVerifyUrl: "/auth/webauthn/register/verify",
      actions: passkeyActions,
    },
    providerLinks: {
      google: { method: "GET", url: "/auth/google?linking=true", onlineOnly: true },
      github: { method: "GET", url: "/auth/github?linking=true", onlineOnly: true },
      apple: { method: "GET", url: "/auth/apple?linking=true", onlineOnly: true },
    },
  };
}

export async function loadNativeAccountSnapshot(db: Database, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      hashedPassword: true,
      photoUrl: true,
      OAuth: {
        select: { provider: true, providerUsername: true },
        orderBy: { provider: "asc" },
      },
    },
  });

  if (!user) {
    return failure("not_found", "Account not found");
  }

  const passkeys = await listUserPasskeys(db, userId);
  const pushCount = await db.pushSubscription.count({ where: { userId } });
  const prefRow = await db.notificationPreference.findUnique({ where: { userId } });
  const preferences = notificationPreferenceFlags(prefRow);
  const apiCredentials = await db.apiCredential.findMany({
    where: { userId, revokedAt: null, oauthClientId: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return success({
    me: {
      id: user.id,
      email: user.email,
      username: user.username,
      hasPassword: user.hashedPassword !== null,
      photoUrl: user.photoUrl,
      oauthAccounts: user.OAuth,
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        name: passkey.name,
        transports: passkey.transports,
        createdAt: passkey.createdAt?.toISOString() ?? null,
      })),
      handoffs: accountHandoffs({
        hasPassword: user.hashedPassword !== null,
        oauthAccountCount: user.OAuth.length,
        passkeyCount: passkeys.length,
      }),
      apiCredentials: apiCredentials.map(credentialMetadata),
      oauthConnections: await loadOAuthConnections(db, userId),
    },
    notifications: {
      pushSubscribed: pushCount > 0,
      preferences,
    },
  });
}

function unknownFieldErrors(body: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) fieldErrors[key] = "Unknown field";
  }
  return fieldErrors;
}

function nonblankStringField(
  body: Record<string, unknown>,
  field: string,
  fieldErrors: Record<string, string>,
  maxLength = 160,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    fieldErrors[field] = `${field} is required`;
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    fieldErrors[field] = `${field} must be at most ${maxLength} characters`;
    return undefined;
  }
  return trimmed;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function updateNativeAccountProfile(
  db: Database,
  userId: string,
  body: Record<string, unknown>,
) {
  const fieldErrors = unknownFieldErrors(body, ["email", "username"]);
  const email = nonblankStringField(body, "email", fieldErrors);
  const username = nonblankStringField(body, "username", fieldErrors);

  if (email !== undefined && !isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return failure("validation_error", "Invalid account profile fields", { fieldErrors });
  }

  const current = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, username: true },
  });
  if (!current) return failure("not_found", "Account not found");

  const normalizedEmail = email?.toLowerCase();
  if (normalizedEmail && normalizedEmail !== current.email.toLowerCase()) {
    const existingEmail = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM User WHERE LOWER(email) = ${normalizedEmail} AND id != ${userId}
    `;
    if (existingEmail.length > 0) {
      fieldErrors.email = "This email is already in use by another account";
    }
  }

  if (username && username !== current.username) {
    const existingUsername = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existingUsername && existingUsername.id !== userId) {
      fieldErrors.username = "This username is already taken";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return failure("validation_error", "Invalid account profile fields", { fieldErrors });
  }

  if (normalizedEmail || username) {
    await db.user.update({
      where: { id: userId },
      data: {
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
        ...(username ? { username } : {}),
      },
    });
  }

  return loadNativeAccountSnapshot(db, userId);
}

export async function uploadNativeAccountPhoto(
  db: Database,
  userId: string,
  formData: FormData,
  bucket?: R2Bucket,
) {
  const photo = formData.get("photo");
  if (!hasUploadedImageFile(photo)) {
    return failure("validation_error", "Please select a photo to upload", {
      reason: "no_file",
      fieldErrors: { photo: "Please select a photo to upload" },
    });
  }

  const imageError = validateImageFile(photo, {
    allowedTypes: PROFILE_IMAGE_TYPES,
    messages: {
      invalidType: "Please upload an image file",
      fileTooLarge: "Photo must be less than 5MB",
    },
  });

  if (imageError) {
    const reason = imageError === "Photo must be less than 5MB" ? "file_too_large" : "invalid_file_type";
    return failure("validation_error", imageError, {
      reason,
      fieldErrors: { photo: imageError },
    });
  }

  const photoUrl = await storeImage({
    bucket,
    file: photo,
    namespace: `profiles/${userId}`,
  });
  await db.user.update({
    where: { id: userId },
    data: { photoUrl },
  });

  return success({ photoUrl, me: { id: userId, photoUrl } });
}

export async function removeNativeAccountPhoto(db: Database, userId: string, bucket?: R2Bucket) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { photoUrl: true },
  });
  if (!user) return failure("not_found", "Account not found");

  const removed = Boolean(user.photoUrl);
  if (removed) {
    await deleteStoredImage({ bucket, imageUrl: user.photoUrl });
    await db.user.update({
      where: { id: userId },
      data: { photoUrl: null },
    });
  }

  return success({ removed, photoUrl: null, me: { id: userId, photoUrl: null } });
}

export async function readNativeNotificationPreferences(db: Database, userId: string) {
  const prefRow = await db.notificationPreference.findUnique({ where: { userId } });
  return success({
    preferences: notificationPreferenceFlags(prefRow),
  });
}

export async function updateNativeNotificationPreferences(
  db: Database,
  userId: string,
  body: Record<string, unknown>,
) {
  const fieldErrors = unknownFieldErrors(body, NOTIFICATION_KEYS);
  const updates: Partial<NotificationPreferenceFlags> = {};

  for (const key of NOTIFICATION_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") {
      fieldErrors[key] = `${key} must be a boolean`;
      continue;
    }
    updates[key] = body[key];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return failure("validation_error", "Invalid notification preferences", { fieldErrors });
  }

  const prefRow = await db.notificationPreference.findUnique({ where: { userId } });
  const preferences = { ...notificationPreferenceFlags(prefRow), ...updates };
  const row = await db.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...preferences },
    update: preferences,
  });

  return success({
    preferences: {
      notifySpoonOnMyRecipe: row.notifySpoonOnMyRecipe,
      notifyForkOfMyRecipe: row.notifyForkOfMyRecipe,
      notifyCookbookSaveOfMine: row.notifyCookbookSaveOfMine,
      notifyFellowChefOriginCook: row.notifyFellowChefOriginCook,
    },
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashApnsToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function devicePayload(device: NativePushDevice) {
  return {
    id: device.id,
    deviceId: device.deviceId,
    platform: device.platform,
    environment: device.environment,
    tokenPrefix: device.tokenPrefix,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    enabledAt: device.enabledAt.toISOString(),
    revokedAt: device.revokedAt ?? null,
    lastRegisteredAt: device.lastRegisteredAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}

export async function registerNativePushDevice(
  db: Database,
  userId: string,
  body: Record<string, unknown>,
) {
  const fieldErrors = unknownFieldErrors(body, APNS_FIELDS);
  const deviceId = nonblankStringField(body, "deviceId", fieldErrors);
  const platform = nonblankStringField(body, "platform", fieldErrors);
  const environment = nonblankStringField(body, "environment", fieldErrors);
  const token = nonblankStringField(body, "token", fieldErrors, 4096);
  const deviceName = body.deviceName === undefined || body.deviceName === null
    ? null
    : nonblankStringField(body, "deviceName", fieldErrors);
  const appVersion = body.appVersion === undefined || body.appVersion === null
    ? null
    : nonblankStringField(body, "appVersion", fieldErrors);

  if (platform && !NATIVE_PLATFORMS.has(platform)) {
    fieldErrors.platform = "platform must be ios, ipados, or macos";
  }
  if (environment && !APNS_ENVIRONMENTS.has(environment)) {
    fieldErrors.environment = "environment must be development or production";
  }
  if (Object.keys(fieldErrors).length > 0 || !deviceId || !platform || !environment || !token) {
    return failure("validation_error", "Invalid APNs device registration", { fieldErrors });
  }

  const tokenHash = await hashApnsToken(token);
  const now = new Date();
  const existing = await db.nativePushDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
  });
  const device = existing
    ? await db.nativePushDevice.update({
        where: { id: existing.id },
        data: {
          platform,
          environment,
          tokenHash,
          tokenPrefix: token.slice(0, 12),
          deviceName,
          appVersion,
          enabledAt: now,
          revokedAt: null,
          lastRegisteredAt: now,
        },
      })
    : await db.nativePushDevice.create({
        data: {
          userId,
          deviceId,
          platform,
          environment,
          tokenHash,
          tokenPrefix: token.slice(0, 12),
          deviceName,
          appVersion,
          enabledAt: now,
          lastRegisteredAt: now,
        },
      });

  return success({ created: !existing, device: devicePayload(device) }, existing ? 200 : 201);
}

export async function revokeNativePushDevice(db: Database, userId: string, deviceId: string) {
  const existing = await db.nativePushDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
  });
  if (!existing) {
    return failure("not_found", "Native push device not found");
  }

  const revoked = existing.revokedAt === null;
  const device = revoked
    ? await db.nativePushDevice.update({
        where: { id: existing.id },
        data: { revokedAt: new Date().toISOString() },
      })
    : existing;

  return success({ revoked, device: devicePayload(device) });
}

export async function listNativeOAuthConnections(db: Database, userId: string) {
  return success({ connections: await loadOAuthConnections(db, userId) });
}

export async function disconnectNativeOAuthConnection(
  db: Database,
  userId: string,
  connectionId: string,
) {
  const parsed = parseNativeConnectionId(connectionId);
  if (!parsed) {
    return failure("not_found", "OAuth connection not found");
  }

  const connections = await loadOAuthConnections(db, userId);
  const connection = connections.find((candidate) => candidate.id === connectionId);
  if (!connection) {
    return failure("not_found", "OAuth connection not found");
  }

  const now = new Date();
  await db.oAuthRefreshToken.updateMany({
    where: { userId, clientId: parsed.clientId, resource: parsed.resource, revokedAt: null },
    data: { revokedAt: now },
  });
  await db.apiCredential.updateMany({
    where: {
      userId,
      oauthClientId: parsed.clientId,
      oauthResource: parsed.resource,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });

  return success({ disconnected: true, connection });
}
