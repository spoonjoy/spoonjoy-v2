import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { authenticateUserByEmailOrUsername } from "~/lib/auth.server";
import {
  NATIVE_APPLE_CLIENT_ID,
  NATIVE_APPLE_CLIENT_NAME,
  NATIVE_APPLE_TOKEN_SCOPE,
} from "~/lib/apple-native-auth.server";
import { issueConnectorTokens, type IssuedConnectorTokens } from "~/lib/oauth-server.server";

type Database = PrismaClientType;

export interface NativePasswordCredentialInput {
  emailOrUsername: string;
  password: string;
}

export interface NativePasswordAuthResult {
  action: "user_logged_in";
  userId: string;
  tokens: IssuedConnectorTokens;
}

export class NativePasswordAuthError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "NativePasswordAuthError";
    this.code = code;
    this.status = status;
  }
}

export async function handleNativePasswordSignIn(
  db: Database,
  input: NativePasswordCredentialInput,
  options: { now?: Date } = {},
): Promise<NativePasswordAuthResult> {
  const user = await authenticateUserByEmailOrUsername(
    db,
    input.emailOrUsername,
    input.password,
  );
  if (!user) {
    throw new NativePasswordAuthError("invalid_credentials", "Invalid username/email or password.", 401);
  }

  await db.oAuthClient.upsert({
    where: { id: NATIVE_APPLE_CLIENT_ID },
    create: {
      id: NATIVE_APPLE_CLIENT_ID,
      clientName: NATIVE_APPLE_CLIENT_NAME,
      redirectUris: "spoonjoy-native://password-sign-in",
    },
    update: {
      clientName: NATIVE_APPLE_CLIENT_NAME,
    },
  });
  const tokens = await issueConnectorTokens(db, {
    userId: user.id,
    clientId: NATIVE_APPLE_CLIENT_ID,
    scope: NATIVE_APPLE_TOKEN_SCOPE,
    resource: null,
    now: options.now,
  });

  return { action: "user_logged_in", userId: user.id, tokens };
}
