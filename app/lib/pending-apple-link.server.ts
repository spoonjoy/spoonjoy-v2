// A pending Apple link: Apple vouched for an Apple ID (its `sub`) but sent no email, and no Spoonjoy
// account is linked to it, so the sign-in can't find or create an account. Instead of a dead end,
// the verified sub is kept for a short while as a server-side row, keyed by the SHA-256 of a random
// opaque token. Whoever holds the token (the native app in memory, or the browser in a signed
// HttpOnly cookie) and then signs in another way gets Apple linked to that account, once.
//
// The row is the source of truth, so a pending link is single-use and expires even when a copy of
// its token survives (a cookie a browser kept, a value a client retried with). Only the token's hash
// is stored; a forged or altered token matches no row.

import type { PrismaClient } from "@prisma/client";
import { createCookie } from "react-router";
import { retryD1Write } from "~/lib/d1-write-retry.server";
import { findExistingOAuthAccount, linkOAuthAccount } from "~/lib/oauth-user.server";
import { signedCookieSettings, type SessionEnv } from "~/lib/session.server";

/** An Apple sign-in that verified but carried no email, for an Apple ID linked to no account. */
export const APPLE_EMAIL_UNAVAILABLE = "apple_email_unavailable";
export const PENDING_APPLE_LINK_TTL_MS = 30 * 60 * 1000;
export const PENDING_APPLE_LINK_TOKEN_PREFIX = "pal_";
export const PENDING_APPLE_LINK_MESSAGE =
  "No Spoonjoy account uses this Apple ID yet. Sign in with Google or your password and we'll connect Apple for you.";
const PENDING_APPLE_LINK_COOKIE = "__apple_pending";
const APPLE_PROVIDER_USERNAME_FALLBACK = "Apple ID";
const MAX_TOKEN_LENGTH = 128;

export type PendingAppleLinkOutcome =
  | "linked"
  | "already_linked"
  | "taken"
  | "provider_already_linked"
  | "expired"
  | "consumed"
  | "invalid"
  | "error";

export interface PendingAppleLink {
  token: string;
  expiresAt: Date;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A support handle for an Apple sub: the first 16 hex characters of its SHA-256, never the sub. */
export async function appleSubSupportHash(sub: string): Promise<string> {
  return (await sha256Hex(sub)).slice(0, 16);
}

async function logPendingAppleLink(event: "created" | PendingAppleLinkOutcome, sub: string | null, extra: Record<string, string> = {}) {
  console.info(JSON.stringify({
    event: "apple.pending_link",
    outcome: event,
    apple_sub_hash: sub === null ? null : await appleSubSupportHash(sub),
    ...extra,
  }));
}

/** Keep a verified, email-less, unlinked Apple sub for thirty minutes, and return its token. */
export async function createPendingAppleLink(
  db: PrismaClient,
  input: { appleSub: string; providerUsername: string | null },
  options: { now?: Date } = {},
): Promise<PendingAppleLink> {
  const now = options.now ?? new Date();
  const token = PENDING_APPLE_LINK_TOKEN_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(now.getTime() + PENDING_APPLE_LINK_TTL_MS);
  const tokenHash = await sha256Hex(token);
  // The token hash is unique, so a retry after a write that had committed finds its own row.
  // Expired rows are no use to anyone: clear them as new ones arrive. This is housekeeping, so a
  // failure is logged and the new link is made anyway.
  await retryD1Write({ scope: "pending_apple_link.prune" }, () => db.pendingAppleLink.deleteMany({
    where: { expiresAt: { lt: now } },
  })).catch((error: unknown) => {
    console.warn(JSON.stringify({
      event: "apple.pending_link",
      outcome: "prune_failed",
      error: error instanceof Error ? error.name : "unknown",
    }));
  });
  await retryD1Write({
    scope: "pending_apple_link.create",
    applied: () => db.pendingAppleLink.findUnique({ where: { tokenHash } }),
  }, () => db.pendingAppleLink.create({
    data: { tokenHash, appleSub: input.appleSub, providerUsername: input.providerUsername, expiresAt },
  }));
  await logPendingAppleLink("created", input.appleSub);
  return { token, expiresAt };
}

/**
 * Link the pending Apple sub behind `token` to `userId`, which has just signed in another way.
 * The row is spent first, atomically, so two sign-ins racing on one token link it at most once.
 * An Apple sub already linked to an account stays where it is.
 *
 * It never throws: the sign-in it follows has already succeeded, so a database failure here
 * returns "error" and, when the row was already spent, puts it back so a retry can still link.
 */
export async function claimPendingAppleLink(
  db: PrismaClient,
  token: string,
  userId: string,
  options: { now?: Date } = {},
): Promise<PendingAppleLinkOutcome> {
  const spent: { id: string | null } = { id: null };
  try {
    return await claimPendingAppleLinkOnce(db, token, userId, options.now ?? new Date(), spent);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "apple.pending_link",
      outcome: "error",
      error: error instanceof Error ? error.name : "unknown",
    }));
    if (spent.id) {
      await db.pendingAppleLink.updateMany({ where: { id: spent.id }, data: { consumedAt: null } }).catch(() => undefined);
    }
    return "error";
  }
}

async function claimPendingAppleLinkOnce(
  db: PrismaClient,
  token: string,
  userId: string,
  now: Date,
  spent: { id: string | null },
): Promise<PendingAppleLinkOutcome> {
  if (!token.startsWith(PENDING_APPLE_LINK_TOKEN_PREFIX) || token.length > MAX_TOKEN_LENGTH) {
    await logPendingAppleLink("invalid", null);
    return "invalid";
  }
  const row = await db.pendingAppleLink.findUnique({ where: { tokenHash: await sha256Hex(token) } });
  if (!row) {
    await logPendingAppleLink("invalid", null);
    return "invalid";
  }
  if (row.consumedAt) {
    await logPendingAppleLink("consumed", row.appleSub);
    return "consumed";
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await logPendingAppleLink("expired", row.appleSub);
    return "expired";
  }
  const { count } = await db.pendingAppleLink.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (count !== 1) {
    await logPendingAppleLink("consumed", row.appleSub);
    return "consumed";
  }
  spent.id = row.id;

  const existing = await findExistingOAuthAccount(db, "apple", row.appleSub);
  if (existing) {
    const outcome = existing.userId === userId ? "already_linked" : "taken";
    await logPendingAppleLink(outcome, row.appleSub);
    return outcome;
  }
  const linked = await linkOAuthAccount(db, userId, {
    provider: "apple",
    providerUserId: row.appleSub,
    providerUsername: row.providerUsername ?? APPLE_PROVIDER_USERNAME_FALLBACK,
  });
  // linkOAuthAccount refuses a sub another account took since the check above, and an account
  // that already has a different Apple ID linked.
  const outcome: PendingAppleLinkOutcome = linked.success
    ? "linked"
    : linked.error === "provider_already_linked" ? "provider_already_linked" : "taken";
  await logPendingAppleLink(outcome, row.appleSub);
  return outcome;
}

function pendingAppleLinkCookie(env: SessionEnv | null | undefined, request: Request) {
  const { secret, secure } = signedCookieSettings(env, request);
  return createCookie(PENDING_APPLE_LINK_COOKIE, {
    secrets: [secret],
    secure,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_APPLE_LINK_TTL_MS / 1000,
  });
}

/** A Set-Cookie value that hands the browser a pending link's token, signed and HttpOnly. */
export async function rememberPendingAppleLink(
  env: SessionEnv | null | undefined,
  request: Request,
  link: PendingAppleLink,
): Promise<string> {
  return pendingAppleLinkCookie(env, request).serialize(link.token, { expires: link.expiresAt });
}

/**
 * `createPendingAppleLink` that answers null instead of throwing, for a caller that still has to
 * explain the refusal when the link can't be saved.
 */
export async function tryCreatePendingAppleLink(
  db: PrismaClient,
  input: { appleSub: string; providerUsername: string | null },
  options: { now?: Date } = {},
): Promise<PendingAppleLink | null> {
  try {
    return await createPendingAppleLink(db, input, options);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "apple.pending_link",
      outcome: "create_failed",
      error: error instanceof Error ? error.name : "unknown",
    }));
    return null;
  }
}

/**
 * After a web sign-in as `userId`: claim the browser's pending Apple link, if it has one, and
 * return the Set-Cookie value that clears it. Returns null, without touching the database, when the
 * request carries no pending link (a cookie whose signature fails reads as none).
 */
export async function claimPendingAppleLinkFromCookie(
  getDb: () => Promise<PrismaClient>,
  request: Request,
  env: SessionEnv | null | undefined,
  userId: string,
): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader || !new RegExp(`(?:^|;\\s*)${PENDING_APPLE_LINK_COOKIE}=`).test(cookieHeader)) return null;
  const cookie = pendingAppleLinkCookie(env, request);
  try {
    const token = await cookie.parse(cookieHeader);
    if (typeof token === "string") {
      await claimPendingAppleLink(await getDb(), token, userId);
    } else {
      await logPendingAppleLink("invalid", null, { source: "cookie" });
    }
  } catch (error) {
    // The sign-in already succeeded; a link that can't be claimed must not undo it.
    console.warn(JSON.stringify({
      event: "apple.pending_link",
      outcome: "error",
      source: "cookie",
      error: error instanceof Error ? error.name : "unknown",
    }));
  }
  return cookie.serialize("", { maxAge: 0, expires: new Date(0) });
}
