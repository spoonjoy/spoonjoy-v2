// One normalisation and one validity check for the email addresses people type (signup, account
// settings and the API's PATCH /me). Stored emails are lowercase, so lookups and uniqueness checks
// compare lowercase values.

// The submitted email without surrounding whitespace, lowercased. Anything that isn't a string is
// an empty email.
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// A local part, an "@", and a domain with a dot, with no whitespace anywhere.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
