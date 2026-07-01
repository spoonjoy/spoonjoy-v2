import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

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

  return { id: user.id, email: user.email, username: user.username };
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
        },
      })
    : await db.user.findUnique({
        where: { username: identifier },
        select: {
          id: true,
          email: true,
          username: true,
          hashedPassword: true,
        },
      });

  return authenticatePasswordUser(user, password);
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
