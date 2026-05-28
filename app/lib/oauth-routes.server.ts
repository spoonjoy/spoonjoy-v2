/**
 * HTTP handlers for the OAuth 2.1 authorization-server endpoints, kept in a
 * coverage-measured lib behind thin route shells (mirrors `http-mcp.server.ts`
 * under `mcp.ts`). The wire formats follow RFC 6749 / 7591 / 7636; the grant
 * logic lives in `oauth-server.server.ts`.
 *
 * Tokens are long-lived `ApiCredential`s (no refresh), so the token endpoint's
 * job is simply: validate the PKCE code grant, then mint a credential.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { getUserId } from "~/lib/session.server";
import { createApiCredential } from "~/lib/api-auth.server";
import {
  clientAllowsRedirect,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getOAuthClient,
  normalizeScope,
  OAuthError,
  registerOAuthClient,
} from "~/lib/oauth-server.server";

type Database = PrismaClientType;

interface OAuthEnv {
  SESSION_SECRET?: string;
}

function oauthErrorResponse(error: unknown): Response {
  /* istanbul ignore if -- @preserve unexpected errors bubble to the platform handler */
  if (!(error instanceof OAuthError)) {
    throw error;
  }
  return Response.json(
    { error: error.code, error_description: error.message },
    { status: error.status },
  );
}

/** RFC 7591 Dynamic Client Registration. */
export async function handleOAuthRegister(request: Request, db: Database): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "invalid_request", error_description: "POST required" }, { status: 405 });
  }

  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_request", error_description: "Invalid JSON body" }, { status: 400 });
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  const clientName = typeof body.client_name === "string" ? body.client_name : null;

  try {
    const client = await registerOAuthClient(db, { clientName, redirectUris });
    return Response.json(
      {
        client_id: client.clientId,
        client_name: client.clientName ?? undefined,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
      { status: 201 },
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

/** RFC 6749 §4.1.3 token endpoint (authorization_code grant, PKCE, public client). */
export async function handleOAuthToken(
  request: Request,
  db: Database,
  env: OAuthEnv | null | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "invalid_request", error_description: "POST required" }, { status: 405 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_request", error_description: "Invalid form body" }, { status: 400 });
  }
  const field = (name: string) => form.get(name)?.toString() ?? "";

  const grantType = field("grant_type");
  if (grantType !== "authorization_code") {
    return Response.json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code is supported" },
      { status: 400 },
    );
  }

  try {
    const grant = await consumeAuthorizationCode(db, {
      code: field("code"),
      clientId: field("client_id"),
      redirectUri: field("redirect_uri"),
      codeVerifier: field("code_verifier"),
    });
    const { token } = await createApiCredential(db, grant.userId, "Claude connector (OAuth)");
    return Response.json({
      access_token: token,
      token_type: "Bearer",
      scope: grant.scope,
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export interface AuthorizeRequestParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  resource: string;
}

export type AuthorizeView =
  | { kind: "consent"; clientName: string | null; scope: string; params: AuthorizeRequestParams }
  | { kind: "error"; message: string };

function readAuthorizeParams(source: URLSearchParams | FormData): AuthorizeRequestParams {
  const get = (name: string) => (source.get(name) ?? "").toString();
  return {
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    state: get("state"),
    scope: get("scope"),
    codeChallenge: get("code_challenge"),
    resource: get("resource"),
  };
}

/**
 * Validate the client + redirect URI before we trust them enough to redirect
 * back to. A bad client/redirect surfaces an on-site error (never an open
 * redirect); other problems are reported to the client via `redirect_uri`.
 */
async function validateClientRedirect(
  db: Database,
  params: AuthorizeRequestParams,
): Promise<{ ok: true; clientName: string | null } | { ok: false; message: string }> {
  const client = await getOAuthClient(db, params.clientId);
  if (!client) return { ok: false, message: "Unknown OAuth client." };
  if (!params.redirectUri || !clientAllowsRedirect(client, params.redirectUri)) {
    return { ok: false, message: "The redirect URI is not registered for this client." };
  }
  return { ok: true, clientName: client.clientName };
}

function redirectBackWithError(params: AuthorizeRequestParams, code: string): Response {
  const url = new URL(params.redirectUri);
  url.searchParams.set("error", code);
  if (params.state) url.searchParams.set("state", params.state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

/**
 * GET /oauth/authorize. Returns either a redirect (login gate / error back to
 * the client) or the consent view data for the route to render.
 */
export async function loadOAuthAuthorize(
  request: Request,
  db: Database,
  env: OAuthEnv | null | undefined,
): Promise<AuthorizeView | Response> {
  const url = new URL(request.url);
  const params = readAuthorizeParams(url.searchParams);

  const validation = await validateClientRedirect(db, params);
  if (!validation.ok) return { kind: "error", message: validation.message };

  // Past this point we can safely report errors back to the client.
  if (url.searchParams.get("response_type") !== "code") {
    return redirectBackWithError(params, "unsupported_response_type");
  }
  if (url.searchParams.get("code_challenge_method") !== "S256" || !params.codeChallenge) {
    return redirectBackWithError(params, "invalid_request");
  }
  let scope: string;
  try {
    scope = normalizeScope(params.scope);
  } catch {
    return redirectBackWithError(params, "invalid_scope");
  }

  const userId = await getUserId(request, env);
  if (!userId) {
    const returnTo = `${url.pathname}${url.search}`;
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?redirectTo=${encodeURIComponent(returnTo)}` },
    });
  }

  return { kind: "consent", clientName: validation.clientName, scope, params: { ...params, scope } };
}

/**
 * POST /oauth/authorize (the consent form). On approve, mint a code and
 * redirect back with it; on deny, redirect back with access_denied.
 */
export async function handleOAuthAuthorizeAction(
  request: Request,
  db: Database,
  env: OAuthEnv | null | undefined,
): Promise<Response> {
  const form = await request.formData();
  const params = readAuthorizeParams(form);
  const decision = (form.get("decision") ?? "").toString();

  const validation = await validateClientRedirect(db, params);
  if (!validation.ok) {
    return Response.json({ error: "invalid_request", error_description: validation.message }, { status: 400 });
  }

  const userId = await getUserId(request, env);
  if (!userId) {
    const returnTo = `/oauth/authorize?${new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: "code",
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      scope: params.scope,
      state: params.state,
      resource: params.resource,
    })}`;
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?redirectTo=${encodeURIComponent(returnTo)}` },
    });
  }

  if (decision !== "approve") {
    return redirectBackWithError(params, "access_denied");
  }

  let scope: string;
  try {
    scope = normalizeScope(params.scope);
  } catch {
    return redirectBackWithError(params, "invalid_scope");
  }

  const code = await createAuthorizationCode(db, {
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope,
    resource: params.resource || null,
  });

  const url = new URL(params.redirectUri);
  url.searchParams.set("code", code);
  if (params.state) url.searchParams.set("state", params.state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}
