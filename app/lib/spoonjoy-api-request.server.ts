/**
 * Shared request-handling helpers for the Spoonjoy operation layer.
 *
 * Both the REST surface (`app/routes/api.$.ts`) and the MCP surfaces (stdio
 * bridge, HTTP `/mcp` connector) authenticate the same way and build the
 * same operation context. This module is the single source of truth for:
 *
 * - which operations are public bootstrap ops (no auth required),
 * - resolving the principal from a request (allowing invalid tokens on
 *   bootstrap ops), and
 * - assembling a `SpoonjoyApiContext` from the Cloudflare env.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import {
  ApiAuthError,
  authenticateApiRequest,
  type ApiPrincipal,
} from "~/lib/api-auth.server";
import type { SpoonjoyApiContext } from "~/lib/spoonjoy-api.server";

/**
 * Operations callable without authentication. These are the discovery /
 * health / delegated-auth-bootstrap ops; everything else requires a
 * principal (enforced inside the operation layer).
 */
export const PUBLIC_BOOTSTRAP_OPERATIONS: ReadonlySet<string> = new Set([
  "health",
  "auth_status",
  "start_agent_connection",
  "poll_agent_connection",
]);

/**
 * Authenticate a request for a given operation. Returns the principal, or
 * `null` when no credentials are present. If a bearer token is present but
 * invalid, the 401 is swallowed (returns `null`) only for public bootstrap
 * operations; otherwise it is rethrown so protected ops fail closed.
 */
export async function resolveApiPrincipal(
  db: PrismaClientType,
  request: Request,
  env: { SESSION_SECRET?: string } | null | undefined,
  operation: string,
): Promise<ApiPrincipal | null> {
  try {
    return await authenticateApiRequest(db, request, env);
  } catch (error) {
    if (
      error instanceof ApiAuthError &&
      error.status === 401 &&
      PUBLIC_BOOTSTRAP_OPERATIONS.has(operation)
    ) {
      return null;
    }
    throw error;
  }
}

interface CloudflareEnvLike {
  OPENAI_API_KEY?: string;
  SPOONJOY_BASE_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PHOTOS?: R2Bucket;
}

/**
 * Assemble the operation context shared by REST + MCP. Owner-email fallback
 * is always disabled here: callers act only as their authenticated principal.
 */
export function buildSpoonjoyApiContext(params: {
  db: PrismaClientType;
  principal: ApiPrincipal | null;
  cloudflareEnv: CloudflareEnvLike | null | undefined;
  waitUntil?: (promise: Promise<unknown>) => void;
}): SpoonjoyApiContext {
  const { db, principal, cloudflareEnv, waitUntil } = params;
  return {
    db,
    principal,
    allowOwnerEmailFallback: false,
    waitUntil,
    env: cloudflareEnv
      ? {
          OPENAI_API_KEY: cloudflareEnv.OPENAI_API_KEY,
          SPOONJOY_BASE_URL: cloudflareEnv.SPOONJOY_BASE_URL,
          VAPID_PUBLIC_KEY: cloudflareEnv.VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY: cloudflareEnv.VAPID_PRIVATE_KEY,
          VAPID_SUBJECT: cloudflareEnv.VAPID_SUBJECT,
        }
      : null,
    bucket: cloudflareEnv?.PHOTOS ?? undefined,
  };
}
