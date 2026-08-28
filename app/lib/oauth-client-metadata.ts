export const MAX_OAUTH_CLIENT_NAME_CODE_POINTS = 80;

const PROHIBITED_OAUTH_CLIENT_NAME_CHARACTERS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function hasProhibitedOAuthClientNameCharacters(value: string): boolean {
  return PROHIBITED_OAUTH_CLIENT_NAME_CHARACTERS.test(value);
}

export function safeOAuthClientDisplayName(value: string | null | undefined): string {
  const sanitized = (value ?? "").replace(
    new RegExp(PROHIBITED_OAUTH_CLIENT_NAME_CHARACTERS.source, "gu"),
    "",
  );
  return Array.from(sanitized).slice(0, MAX_OAUTH_CLIENT_NAME_CODE_POINTS).join("").trim() || "This app";
}
