// One rule for the usernames people choose (signup, account settings and the API's PATCH /me). A
// username is part of the chef's profile URL (/users/<username>) and is matched exactly at
// sign-in, so surrounding whitespace is never kept, and only characters that are safe in a URL
// path are allowed. Whether a username is free (regardless of letter case, and not another
// account's ID) is checked against the database in account-identity.server.ts.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

// Also the OpenAPI schema's pattern for UpdateAccountProfileRequest.username.
export const USERNAME_PATTERN_SOURCE = "^[A-Za-z0-9._-]+$";
const USERNAME_PATTERN = new RegExp(USERNAME_PATTERN_SOURCE);
const HAS_LETTER_OR_DIGIT = /[A-Za-z0-9]/;
// Prisma's cuid() account IDs: "c" and 24 more lowercase letters or digits. /users/<identifier>
// falls back to an ID lookup, so a username shaped like one would be confusing at best.
const ACCOUNT_ID_SHAPE = /^c[a-z0-9]{24}$/i;

// The submitted username without leading or trailing whitespace. A missing field, a file where
// text was expected, or a non-string JSON value is an empty username.
export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The message to show for a username that breaks the rule, or null when it is fine. Expects a
// username that has already been through normalizeUsername.
export function usernameFormatError(username: string): string | null {
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Username can only use letters, numbers, periods, underscores and hyphens";
  }
  if (!HAS_LETTER_OR_DIGIT.test(username)) {
    return "Username must include a letter or a number";
  }
  if (ACCOUNT_ID_SHAPE.test(username)) {
    return "Username can't look like an account ID";
  }
  return null;
}
