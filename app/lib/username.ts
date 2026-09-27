// One rule for the usernames people choose (signup and account settings). A username is part of
// the chef's profile URL (/users/<username>) and is matched exactly at sign-in, so surrounding
// whitespace is never kept, and only characters that are safe in a URL path are allowed.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// The submitted username without leading or trailing whitespace. A missing field, or a file where
// text was expected, is an empty username.
export function normalizeUsername(value: FormDataEntryValue | null | undefined): string {
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
  return null;
}
