// WebKit logs "Fetch API cannot load <url> due to access control checks." when it cuts off a
// fetch that is still in flight as the page navigates away, even though the page caught the
// rejection (the recipe page's cook-session sync does: its client returns "transient"). Playwright
// reports that log on WebKit as a pageerror. For a same-origin URL it can only mean that the
// request was cut off, because a same-origin request is never subject to CORS, so the console
// gate ignores it. The same message for another origin is a real CORS failure and still fails.
const CANCELLED_FETCH = /Fetch API cannot load (\S+) due to access control checks\./;

export function isWebKitCancelledSameOriginFetch(
  error: { message: string; stack?: string },
  baseUrl: string | undefined,
): boolean {
  if (!baseUrl) return false;
  // Playwright splits WebKit's text at the URL's scheme colon, so the message alone may hold only
  // "//host/path due to access control checks."; the stack keeps the whole first line.
  const match = CANCELLED_FETCH.exec(error.stack ?? "") ?? CANCELLED_FETCH.exec(error.message);
  if (!match) return false;
  try {
    return new URL(match[1]).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
