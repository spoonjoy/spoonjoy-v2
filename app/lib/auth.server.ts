import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { d1ReadBatch, type D1ReadDatabase } from "~/lib/d1-read.server";

const SALT_ROUNDS = 10;

// A pre-computed bcrypt hash (cost factor 10, matching SALT_ROUNDS) of an
// arbitrary throwaway sentinel — NOT a real credential. Used as a decoy in
// authenticateUser: when no account matches the email (or the matched account
// has no password, e.g. an OAuth-only user) we still run a bcrypt comparison
// against this hash, so authentication takes ~the same time whether or not the
// account exists. That closes a timing side-channel an attacker could otherwise
// use to enumerate registered emails by measuring login latency (a fast reject
// ⇒ no such user; a slow reject ⇒ user exists, wrong password). Keep the cost
// factor in sync with SALT_ROUNDS so the decoy comparison costs the same as a
// real one.
const DECOY_PASSWORD_HASH =
  "$2b$10$C1PTchFvumkBU2.pJKCp1.tuWM.G5WH2tmIs.Cs1tSK4eYCyDQ0oi";

// Hash password with bcrypt
export async function hashPassword(password: string): Promise<{ hashedPassword: string; salt: string }> {
  const salt = bcrypt.genSaltSync(SALT_ROUNDS);
  const hashedPassword = bcrypt.hashSync(password, salt);
  return { hashedPassword, salt };
}

// Verify password
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compareSync(password, hashedPassword);
}

// Create user
export async function createUser(
  db: PrismaClient,
  email: string,
  username: string,
  password: string
) {
  const { hashedPassword, salt } = await hashPassword(password);

  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      username,
      hashedPassword,
      salt,
    },
  });

  return { id: user.id, email: user.email, username: user.username };
}

type AuthenticatedUser = {
  id: string;
  email: string;
  username: string;
  // Read in the same query as the password hash. A session minted for this
  // sign-in must use this value, not a later read: a password change that lands
  // during the bcrypt compare bumps the version, and the cookie must stay behind it.
  sessionVersion: number;
};

async function authenticatePasswordUser(
  user: (AuthenticatedUser & { hashedPassword: string | null }) | null,
  password: string
): Promise<AuthenticatedUser | null> {
  // Always run a bcrypt comparison — against the stored hash when the account
  // exists with a password, otherwise against DECOY_PASSWORD_HASH — so the
  // dominant cost (a ~70ms bcrypt compare) is paid whether or not the email is
  // registered (anti-enumeration). This equalizes the bcrypt window, not the
  // whole request: the preceding lookup still differs slightly for a hit vs
  // a miss, but that delta is negligible next to bcrypt.
  const isValid = await verifyPassword(
    password,
    user?.hashedPassword ?? DECOY_PASSWORD_HASH
  );

  // When user / hashedPassword is absent, `isValid` was computed against the
  // decoy and is intentionally ignored: the first two operands short-circuit to
  // null, so a decoy match can never authenticate a non-existent account.
  if (!user || !user.hashedPassword || !isValid) {
    return null;
  }

  return { id: user.id, email: user.email, username: user.username, sessionVersion: user.sessionVersion };
}

// Authenticate user by email and password
export async function authenticateUser(
  db: PrismaClient,
  email: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      username: true,
      hashedPassword: true,
      sessionVersion: true,
    },
  });

  return authenticatePasswordUser(user, password);
}

// Authenticate first-party native app sign-in by email or exact username.
export async function authenticateUserByEmailOrUsername(
  db: PrismaClient,
  emailOrUsername: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const identifier = emailOrUsername.trim();
  const user = identifier.includes("@")
    ? await db.user.findUnique({
        where: { email: identifier.toLowerCase() },
        select: {
          id: true,
          email: true,
          username: true,
          hashedPassword: true,
          sessionVersion: true,
        },
      })
    : await db.user.findUnique({
        where: { username: identifier },
        select: {
          id: true,
          email: true,
          username: true,
          hashedPassword: true,
          sessionVersion: true,
        },
      });

  return authenticatePasswordUser(user, password);
}

const LOGIN_USER_COLUMNS = '"id", "email", "username", "hashedPassword", "sessionVersion"';

/**
 * The same password login on the request's D1 binding: one statement finds the user by email
 * (lowercased) or exact username, and the password check is the shared one, decoy included.
 */
export async function authenticateUserByEmailOrUsernameOnD1(
  d1: D1ReadDatabase,
  emailOrUsername: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const identifier = emailOrUsername.trim();
  const [[row]] = await d1ReadBatch(d1, [
    identifier.includes("@")
      ? [`SELECT ${LOGIN_USER_COLUMNS} FROM "User" WHERE "email" = ?`, identifier.toLowerCase()]
      : [`SELECT ${LOGIN_USER_COLUMNS} FROM "User" WHERE "username" = ?`, identifier],
  ]);
  if (
    row &&
    (typeof row.id !== "string" ||
      typeof row.email !== "string" ||
      typeof row.username !== "string" ||
      (row.hashedPassword !== null && typeof row.hashedPassword !== "string") ||
      typeof row.sessionVersion !== "number")
  ) {
    throw new Error("D1 user row is missing a login field");
  }
  const user = row
    ? {
        id: row.id as string,
        email: row.email as string,
        username: row.username as string,
        hashedPassword: row.hashedPassword as string | null,
        sessionVersion: row.sessionVersion as number,
      }
    : null;
  return authenticatePasswordUser(user, password);
}

/**
 * Extract a chef-supplied identifier from a parsed JSON request body that
 * may carry it under `identifier` (preferred) or the legacy `email` field,
 * trimmed. Shared by the WebAuthn authenticate routes (options + verify) so
 * the "identifier ?? email" fallback lives in exactly one place.
 */
export function extractIdentifierFromBody(body: { identifier?: unknown; email?: unknown }): string {
  const raw = typeof body.identifier === "string" ? body.identifier : typeof body.email === "string" ? body.email : "";
  return raw.trim();
}

/**
 * Resolve a chef-supplied identifier (a username or an email) to the
 * account's email address, for callers that must look a user up by email
 * but accept either (e.g. the WebAuthn authenticate routes). Same branching
 * as authenticateUserByEmailOrUsername: a value containing "@" is treated as
 * an email and lowercased; otherwise it's looked up as an exact username.
 * An unknown username resolves to the original identifier unchanged, so a
 * caller that feeds the result into a plain email lookup gets the same "no
 * such user" behavior an unknown email already gets (no enumeration).
 *
 * Expects an already-trimmed identifier (e.g. from extractIdentifierFromBody)
 * — both current callers trim before calling, so this doesn't re-trim.
 */
export async function resolveIdentifierToEmail(db: PrismaClient, identifier: string): Promise<string> {
  if (identifier.includes("@")) {
    return identifier.toLowerCase();
  }
  const user = await db.user.findUnique({ where: { username: identifier }, select: { email: true } });
  return user?.email ?? identifier;
}

// Get user by ID
export async function getUserById(db: PrismaClient, id: string) {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
    },
  });
}

// Check if email exists
export async function emailExists(db: PrismaClient, email: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  return !!user;
}

// Check if username exists
export async function usernameExists(db: PrismaClient, username: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return !!user;
}
