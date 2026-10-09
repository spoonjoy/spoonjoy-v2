// Shared rules for the two agent connection pages (/agent/connect and /agent/connect/:requestId).
//
// Approval needs the code the agent shows the chef, typed by the chef. A link never carries it, so
// someone who starts a request and sends the chef a link can't get it approved with one click. When
// the chef types the code on the lookup page, a short-lived signed cookie remembers it for that one
// request, so they don't type it twice (including across a sign-in round trip).

import { createCookie } from "react-router";
import { parseSerializedHttpOrigin, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { signedCookieSettings, type SessionEnv } from "~/lib/session.server";

export type AgentConnectEnv = (SessionEnv & { SPOONJOY_BASE_URL?: string }) | null | undefined;

const CODE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/** The code as the agent shows it ("ABCD-2345"), from whatever the chef typed. */
export function normalizeUserCode(value: string | null | undefined): string {
  const compact = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

function codeCookie(env: AgentConnectEnv, request: Request) {
  const { secret, secure } = signedCookieSettings(env, request);
  return createCookie("__agent_code", {
    secrets: [secret],
    secure,
    httpOnly: true,
    sameSite: "lax",
    path: "/agent/connect",
    maxAge: CODE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** A Set-Cookie value remembering that the chef typed `userCode` for request `requestId`. */
export async function rememberTypedCode(
  env: AgentConnectEnv,
  request: Request,
  requestId: string,
  userCode: string,
): Promise<string> {
  return codeCookie(env, request).serialize({ requestId, userCode });
}

/** The code the chef typed earlier for this request, if the signed cookie holds one. */
export async function typedCodeFor(env: AgentConnectEnv, request: Request, requestId: string): Promise<string | null> {
  const value = await codeCookie(env, request).parse(request.headers.get("Cookie"));
  if (!value || typeof value !== "object") return null;
  const { requestId: cookieRequestId, userCode } = value as { requestId?: unknown; userCode?: unknown };
  return cookieRequestId === requestId && typeof userCode === "string" ? userCode : null;
}

/**
 * True unless the browser says the form was posted from another site. Another site could otherwise
 * post a known code to the lookup page and land the chef on an approval with the code filled in.
 */
export function isSameSiteFormPost(request: Request, env: AgentConnectEnv): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const parsed = parseSerializedHttpOrigin(origin);
  if (!parsed) return false;
  const requestOrigin = new URL(request.url).origin;
  return parsed === requestOrigin || parsed === resolveIssuerOrigin(request.url, env?.SPOONJOY_BASE_URL);
}
