import type { PrismaClient } from "@prisma/client";

// Who may make an account on a self-hosted server (docs/self-hosting.md). A server says it is
// self-hosted with SPOONJOY_SELF_HOSTED=true, which the image sets (self-host/config.mjs). There,
// the first account is the server's admin, and once it exists the server is invite-only unless
// the admin opens sign-ups or SPOONJOY_SIGNUPS says otherwise. An invite link lets one person in.
// spoonjoy.app doesn't set the flag, and nothing here reads or writes its database.
//
// Every path that makes an account asks gateAccountCreation first and tells it how that went.

export interface ServerAccessEnv {
  SPOONJOY_SELF_HOSTED?: string;
  SPOONJOY_SIGNUPS?: string;
}

export type SignupMode = "open" | "invite";

export const INVITE_ONLY_MESSAGE = "This server is invite-only. Ask its owner for an invite link.";

/** The error code an account-creation path answers with when the gate refuses. */
export const SIGNUPS_CLOSED = "signups_closed";

export const SERVER_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_KEY = "admin";
const SIGNUPS_KEY = "signups";

type Database = PrismaClient;

export function isSelfHosted(env: ServerAccessEnv | null | undefined): boolean {
  return env?.SPOONJOY_SELF_HOSTED?.trim().toLowerCase() === "true";
}

function signupModeFromEnv(env: ServerAccessEnv | null | undefined): SignupMode | null {
  const value = env?.SPOONJOY_SIGNUPS?.trim().toLowerCase();
  return value === "open" || value === "invite" ? value : null;
}

export type AccountCreationGate =
  | {
      allowed: true;
      /** Call once the account exists: it uses up the invite and, on a new server, makes the admin. */
      created(userId: string): Promise<void>;
      /** Call when no account was made after all (a taken email, a failed write): the invite works again. */
      abandoned(): Promise<void>;
    }
  | { allowed: false; code: typeof SIGNUPS_CLOSED; message: string };

const OPEN_DOOR: AccountCreationGate = { allowed: true, created: async () => {}, abandoned: async () => {} };

/**
 * May someone make an account now? The one gate every account-creation path (password sign-up,
 * OAuth and Sign in with Apple, the MCP owner, and any new one) asks before writing a user.
 * Off a self-hosted server it always says yes and touches nothing. On one, the first account is
 * always let in; after that, sign-ups must be open or `inviteToken` must be an unused, unexpired,
 * unrevoked invite, which this claims so a second sign-up can't use it at the same time.
 */
export async function gateAccountCreation(
  db: Database,
  env: ServerAccessEnv | null | undefined,
  { inviteToken, now = new Date() }: { inviteToken?: string | null; now?: Date } = {},
): Promise<AccountCreationGate> {
  if (!isSelfHosted(env)) return OPEN_DOOR;

  const claimAdmin = async () => {
    await claimServerAdmin(db);
  };
  const empty = !(await db.user.findFirst({ select: { id: true } }));
  if (empty || (await signupMode(db, env)).mode === "open") {
    return { allowed: true, created: claimAdmin, abandoned: async () => {} };
  }

  if (inviteToken) {
    const tokenHash = await hashServerInviteToken(inviteToken);
    const claimed = await db.serverInvite.updateMany({
      where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 1) {
      return {
        allowed: true,
        created: async (userId) => {
          await db.serverInvite.updateMany({ where: { tokenHash }, data: { usedById: userId } });
          await claimAdmin();
        },
        abandoned: async () => {
          await db.serverInvite.updateMany({ where: { tokenHash, usedById: null }, data: { usedAt: null } });
        },
      };
    }
  }
  return { allowed: false, code: SIGNUPS_CLOSED, message: INVITE_ONLY_MESSAGE };
}

/**
 * Makes the oldest account the admin unless the server has one. One INSERT OR IGNORE, so first
 * sign-ups racing on an empty server agree on one admin.
 */
async function claimServerAdmin(db: Database): Promise<void> {
  await db.$executeRaw`INSERT OR IGNORE INTO "ServerSetting" ("key", "value")
    SELECT ${ADMIN_KEY}, "id" FROM "User" ORDER BY "createdAt", "id" LIMIT 1`;
}

/**
 * The admin's account id on a self-hosted server, or null elsewhere and on a server with no
 * accounts. A server with accounts from before it had an admin, or whose admin deleted their
 * account, gets its oldest account as admin.
 */
export async function serverAdminId(db: Database, env: ServerAccessEnv | null | undefined): Promise<string | null> {
  if (!isSelfHosted(env)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await db.serverSetting.findUnique({ where: { key: ADMIN_KEY } });
    if (row && (await db.user.findUnique({ where: { id: row.value }, select: { id: true } }))) return row.value;
    if (row) await db.serverSetting.deleteMany({ where: { key: ADMIN_KEY, value: row.value } });
    await claimServerAdmin(db);
  }
  return (await db.serverSetting.findUnique({ where: { key: ADMIN_KEY } }))?.value ?? null;
}

export async function isServerAdmin(
  db: Database,
  env: ServerAccessEnv | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  return Boolean(userId) && isSelfHosted(env) && (await serverAdminId(db, env)) === userId;
}

/**
 * Whether strangers may sign up, and what decided it: SPOONJOY_SIGNUPS, the admin's switch, or
 * the default, which is invite-only (a server on the internet shouldn't take accounts from anyone
 * who finds it; its owner invites the people they cook with).
 */
export async function signupMode(
  db: Database,
  env: ServerAccessEnv | null | undefined,
): Promise<{ mode: SignupMode; setBy: "env" | "admin" | "default" }> {
  const fromEnv = signupModeFromEnv(env);
  if (fromEnv) return { mode: fromEnv, setBy: "env" };
  const row = await db.serverSetting.findUnique({ where: { key: SIGNUPS_KEY } });
  if (row?.value === "open" || row?.value === "invite") return { mode: row.value, setBy: "admin" };
  return { mode: "invite", setBy: "default" };
}

export async function setSignupMode(db: Database, env: ServerAccessEnv | null | undefined, mode: SignupMode): Promise<void> {
  if (!isSelfHosted(env)) throw new Error("Sign-ups can only be switched on a self-hosted server.");
  await db.serverSetting.upsert({
    where: { key: SIGNUPS_KEY },
    create: { key: SIGNUPS_KEY, value: mode },
    update: { value: mode },
  });
}

// Invite tokens are 32 random bytes in base64url, shown once in the link; only their SHA-256 is stored.
function newServerInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashServerInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ServerInviteRow {
  id: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function createServerInvite(
  db: Database,
  createdById: string,
  now = new Date(),
): Promise<{ token: string; invite: ServerInviteRow }> {
  const token = newServerInviteToken();
  const invite = await db.serverInvite.create({
    data: {
      tokenHash: await hashServerInviteToken(token),
      createdById,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SERVER_INVITE_LIFETIME_MS),
    },
    select: { id: true, createdAt: true, expiresAt: true },
  });
  return { token, invite };
}

/** The invites that still work, newest first. */
export async function listServerInvites(db: Database, now = new Date()): Promise<ServerInviteRow[]> {
  return db.serverInvite.findMany({
    where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeServerInvite(db: Database, id: string, now = new Date()): Promise<void> {
  await db.serverInvite.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
}

export type ServerInviteStatus = "valid" | "used" | "expired" | "revoked" | "unknown";

export async function serverInviteStatus(db: Database, token: string, now = new Date()): Promise<ServerInviteStatus> {
  const invite = await db.serverInvite.findUnique({ where: { tokenHash: await hashServerInviteToken(token) } });
  if (!invite) return "unknown";
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

const INVITE_PROBLEMS: Record<Exclude<ServerInviteStatus, "valid">, string> = {
  used: "This invite link has already been used.",
  expired: "This invite link has expired.",
  revoked: "This invite link was turned off.",
  unknown: "This invite link doesn't work.",
};

/**
 * What the sign-up page offers, without claiming anything: `open` (anyone may sign up), `invite`
 * (this invite link lets them in) or `closed` with the message to show instead of the form.
 */
export async function signupDoor(
  db: Database,
  env: ServerAccessEnv | null | undefined,
  inviteToken: string | null | undefined,
  now = new Date(),
): Promise<{ door: "open" } | { door: "invite" } | { door: "closed"; message: string }> {
  if (!isSelfHosted(env)) return { door: "open" };
  if (!(await db.user.findFirst({ select: { id: true } }))) return { door: "open" };
  if ((await signupMode(db, env)).mode === "open") return { door: "open" };
  if (!inviteToken) return { door: "closed", message: INVITE_ONLY_MESSAGE };
  const status = await serverInviteStatus(db, inviteToken, now);
  if (status === "valid") return { door: "invite" };
  return { door: "closed", message: `${INVITE_PROBLEMS[status]} ${INVITE_ONLY_MESSAGE}` };
}
