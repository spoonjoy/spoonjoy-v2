/**
 * HTTP handlers for the OAuth 2.1 authorization-server endpoints, kept in a
 * coverage-measured lib behind thin route shells (mirrors `http-mcp.server.ts`
 * under `mcp.ts`). The wire formats follow RFC 6749 / 7591 / 7636; the grant
 * logic lives in `oauth-server.server.ts`.
 *
 * The token endpoint validates the PKCE code grant or rotating `refresh_token`
 * grant, then returns a fresh access token plus refresh token pair.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { getUserId } from "~/lib/session.server";
import {
  clientAllowsRedirect,
  consumeAuthorizationCode,
  createAuthorizationCode,
  getOAuthClient,
  issueConnectorTokens,
  normalizeScope,
  OAuthError,
  registerOAuthClient,
  revokeConnectorRefreshToken,
  rotateConnectorTokens,
  type IssuedConnectorTokens,
} from "~/lib/oauth-server.server";
import { mcpResourceUrl, resolveIssuerOrigin } from "~/lib/oauth-metadata.server";

type Database = PrismaClientType;

interface OAuthEnv {
  SESSION_SECRET?: string;
  SPOONJOY_BASE_URL?: string;
}

export interface OAuthRegisterTelemetryMetadata {
  clientId?: string;
  errorCode?: string;
  redirectUriCount?: number;
  scopeCount?: number;
}

const oauthRegisterTelemetrySymbol = Symbol("spoonjoy.oauth.register.telemetry");

export function withOAuthRegisterTelemetry(
  response: Response,
  metadata: OAuthRegisterTelemetryMetadata,
): Response {
  Object.defineProperty(response, oauthRegisterTelemetrySymbol, {
    value: metadata,
    enumerable: false,
  });
  return response;
}

export function oauthRegisterTelemetryFor(response: Response): OAuthRegisterTelemetryMetadata {
  return (response as Response & { [oauthRegisterTelemetrySymbol]?: OAuthRegisterTelemetryMetadata })[oauthRegisterTelemetrySymbol] ?? {};
}

const MAX_OAUTH_JSON_BODY_BYTES = 16 * 1024;
const MAX_OAUTH_FORM_BODY_BYTES = 8 * 1024;

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

function bodyTooLargeError(): OAuthError {
  return new OAuthError("invalid_request", "Request body is too large");
}

async function readLimitedBodyText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw bodyTooLargeError();
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw bodyTooLargeError();
  }
  return text;
}

async function readLimitedJsonBody(request: Request): Promise<RegisterBody> {
  const text = await readLimitedBodyText(request, MAX_OAUTH_JSON_BODY_BYTES);
  return JSON.parse(text) as RegisterBody;
}

function isRegisterBody(value: unknown): value is RegisterBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLimitedFormBody(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await readLimitedBodyText(request, MAX_OAUTH_FORM_BODY_BYTES));
}

function crossOriginConsentResponse(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    // Treat malformed Origin as hostile instead of guessing.
  }
  return Response.json(
    { error: "invalid_request", error_description: "OAuth consent must be submitted from Spoonjoy." },
    { status: 403 },
  );
}

type RegisterBody = {
  redirect_uris?: unknown;
  client_name?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
  application_type?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  policy_uri?: unknown;
  tos_uri?: unknown;
  contacts?: unknown;
  jwks_uri?: unknown;
  jwks?: unknown;
  sector_identifier_uri?: unknown;
  subject_type?: unknown;
  software_id?: unknown;
  software_version?: unknown;
  default_max_age?: unknown;
  require_auth_time?: unknown;
  default_acr_values?: unknown;
  initiate_login_uri?: unknown;
  request_uris?: unknown;
  id_token_signed_response_alg?: unknown;
  id_token_encrypted_response_alg?: unknown;
  id_token_encrypted_response_enc?: unknown;
  userinfo_signed_response_alg?: unknown;
  userinfo_encrypted_response_alg?: unknown;
  userinfo_encrypted_response_enc?: unknown;
  request_object_signing_alg?: unknown;
  request_object_encryption_alg?: unknown;
  request_object_encryption_enc?: unknown;
  token_endpoint_auth_signing_alg?: unknown;
};

const REGISTER_METADATA_FIELDS = new Set([
  "redirect_uris",
  "client_name",
  "token_endpoint_auth_method",
  "grant_types",
  "response_types",
  "scope",
  "application_type",
  "client_uri",
  "logo_uri",
  "policy_uri",
  "tos_uri",
  "contacts",
  "jwks_uri",
  "jwks",
  "sector_identifier_uri",
  "subject_type",
  "software_id",
  "software_version",
  "default_max_age",
  "require_auth_time",
  "default_acr_values",
  "initiate_login_uri",
  "request_uris",
  "id_token_signed_response_alg",
  "id_token_encrypted_response_alg",
  "id_token_encrypted_response_enc",
  "userinfo_signed_response_alg",
  "userinfo_encrypted_response_alg",
  "userinfo_encrypted_response_enc",
  "request_object_signing_alg",
  "request_object_encryption_alg",
  "request_object_encryption_enc",
  "token_endpoint_auth_signing_alg",
]);

function rejectInvalidClientMetadata(message: string): never {
  throw new OAuthError("invalid_client_metadata", message);
}

function validateStringArray(value: unknown, field: string): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    rejectInvalidClientMetadata(`${field} must be an array of strings`);
  }
  return value;
}

function validateRegisterMetadata(body: RegisterBody): void {
  for (const key of Object.keys(body)) {
    if (!REGISTER_METADATA_FIELDS.has(key)) {
      rejectInvalidClientMetadata(`Unsupported client metadata: ${key}`);
    }
  }

  if (
    body.token_endpoint_auth_method !== undefined
    && body.token_endpoint_auth_method !== "none"
  ) {
    rejectInvalidClientMetadata("Only token_endpoint_auth_method: none is supported");
  }

  const grantTypes = validateStringArray(body.grant_types, "grant_types");
  if (grantTypes) {
    const allowed = new Set(["authorization_code", "refresh_token"]);
    if (!grantTypes.includes("authorization_code") || grantTypes.some((grant) => !allowed.has(grant))) {
      rejectInvalidClientMetadata("Supported grant_types are authorization_code and refresh_token");
    }
  }

  const responseTypes = validateStringArray(body.response_types, "response_types");
  if (responseTypes && (responseTypes.length !== 1 || responseTypes[0] !== "code")) {
    rejectInvalidClientMetadata("Only response_types: [\"code\"] is supported");
  }

  if (body.scope !== undefined) {
    if (typeof body.scope !== "string") rejectInvalidClientMetadata("scope must be a string");
    normalizeScope(body.scope);
  }
}

function registerTelemetryForBody(body: RegisterBody): OAuthRegisterTelemetryMetadata {
  const redirectUriCount = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((item) => typeof item === "string").length
    : undefined;
  const trimmedScope = typeof body.scope === "string" ? body.scope.trim() : "";
  return {
    redirectUriCount,
    scopeCount: trimmedScope ? trimmedScope.split(/\s+/).length : undefined,
  };
}

/** RFC 7591 Dynamic Client Registration. */
export async function handleOAuthRegister(request: Request, db: Database): Promise<Response> {
  if (request.method !== "POST") {
    return withOAuthRegisterTelemetry(
      Response.json({ error: "invalid_request", error_description: "POST required" }, { status: 405 }),
      { errorCode: "invalid_request" },
    );
  }

  let body: RegisterBody;
  try {
    body = await readLimitedJsonBody(request);
  } catch (error) {
    if (error instanceof OAuthError) {
      return withOAuthRegisterTelemetry(oauthErrorResponse(error), { errorCode: error.code });
    }
    return withOAuthRegisterTelemetry(
      Response.json({ error: "invalid_request", error_description: "Invalid JSON body" }, { status: 400 }),
      { errorCode: "invalid_request" },
    );
  }
  if (!isRegisterBody(body)) {
    return withOAuthRegisterTelemetry(
      Response.json({ error: "invalid_request", error_description: "Registration metadata must be a JSON object" }, { status: 400 }),
      { errorCode: "invalid_request" },
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  const clientName = typeof body.client_name === "string" ? body.client_name : null;
  const telemetry = registerTelemetryForBody(body);

  try {
    validateRegisterMetadata(body);
    const client = await registerOAuthClient(db, { clientName, redirectUris });
    return withOAuthRegisterTelemetry(
      Response.json(
        {
          client_id: client.clientId,
          client_name: client.clientName ?? undefined,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        { status: 201 },
      ),
      { ...telemetry, clientId: client.clientId },
    );
  } catch (error) {
    if (error instanceof OAuthError) {
      return withOAuthRegisterTelemetry(oauthErrorResponse(error), { ...telemetry, errorCode: error.code });
    }
    return oauthErrorResponse(error);
  }
}

function tokenResponse(tokens: IssuedConnectorTokens): Response {
  return Response.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    scope: tokens.scope,
  }, {
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/**
 * RFC 6749 token endpoint. Supports the `authorization_code` grant (PKCE,
 * public client) and the `refresh_token` grant (rotating). Both return a fresh
 * access token + refresh token.
 */
export async function handleOAuthToken(
  request: Request,
  db: Database,
  env: OAuthEnv | null | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "invalid_request", error_description: "POST required" }, { status: 405 });
  }

  let form: URLSearchParams;
  try {
    form = await readLimitedFormBody(request);
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    return Response.json({ error: "invalid_request", error_description: "Invalid form body" }, { status: 400 });
  }
  const field = (name: string) => form.get(name)?.toString() ?? "";
  const grantType = field("grant_type");

  try {
    if (grantType === "authorization_code") {
      const grant = await consumeAuthorizationCode(db, {
        code: field("code"),
        clientId: field("client_id"),
        redirectUri: field("redirect_uri"),
        codeVerifier: field("code_verifier"),
      });
      return tokenResponse(
        await issueConnectorTokens(db, {
          userId: grant.userId,
          clientId: field("client_id"),
          scope: grant.scope,
          resource: grant.resource,
        }),
      );
    }

    if (grantType === "refresh_token") {
      return tokenResponse(
        await rotateConnectorTokens(db, {
          refreshToken: field("refresh_token"),
          clientId: field("client_id"),
        }),
      );
    }

    return Response.json(
      { error: "unsupported_grant_type", error_description: "Supported grants: authorization_code, refresh_token" },
      { status: 400 },
    );
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

/**
 * RFC 7009-style refresh-token revocation. Spoonjoy OAuth clients are public,
 * so revocation authenticates by possession of the refresh token and optional
 * client_id binding.
 */
export async function handleOAuthRevoke(request: Request, db: Database): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "invalid_request", error_description: "POST required" }, { status: 405 });
  }

  let form: URLSearchParams;
  try {
    form = await readLimitedFormBody(request);
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    return Response.json({ error: "invalid_request", error_description: "Invalid form body" }, { status: 400 });
  }

  try {
    await revokeConnectorRefreshToken(db, {
      refreshToken: (form.get("token") ?? "").toString(),
      clientId: (form.get("client_id") ?? "").toString() || undefined,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export interface AuthorizeRequestParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

export type AuthorizeView =
  | { kind: "consent"; clientName: string | null; scope: string; params: AuthorizeRequestParams }
  | { kind: "error"; message: string };

type OAuthAuthorizeStateClass = "missing" | "short" | "present" | "unknown";

export interface OAuthAuthorizeTelemetryMetadata {
  outcome?: "login_redirect" | "consent" | "client_error" | "redirect_error" | "approved" | "denied" | "rate_limited" | "error";
  clientId?: string;
  principalId?: string;
  decision?: "approve" | "deny" | "other";
  errorCode?: string;
  stateClass?: OAuthAuthorizeStateClass;
  scope?: string;
  resource?: string;
}

const oauthAuthorizeTelemetrySymbol = Symbol("spoonjoy.oauth.authorize.telemetry");

export function withOAuthAuthorizeTelemetry<T extends AuthorizeView | Response>(
  target: T,
  metadata: OAuthAuthorizeTelemetryMetadata,
): T {
  Object.defineProperty(target, oauthAuthorizeTelemetrySymbol, {
    value: metadata,
    enumerable: false,
  });
  return target;
}

export function oauthAuthorizeTelemetryFor(target: AuthorizeView | Response): OAuthAuthorizeTelemetryMetadata {
  return (target as (AuthorizeView | Response) & {
    [oauthAuthorizeTelemetrySymbol]?: OAuthAuthorizeTelemetryMetadata;
  })[oauthAuthorizeTelemetrySymbol] ?? {};
}

function readAuthorizeParams(source: URLSearchParams | FormData): AuthorizeRequestParams {
  const get = (name: string) => (source.get(name) ?? "").toString();
  return {
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    responseType: get("response_type"),
    state: get("state"),
    scope: get("scope"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    resource: get("resource"),
  };
}

function authorizeStateClass(state: string): OAuthAuthorizeStateClass {
  const trimmed = state.trim();
  if (!trimmed) return "missing";
  if (trimmed.length < 16) return "short";
  return "present";
}

export async function oauthAuthorizeTelemetryForRequest(
  request: Request,
  phase: "loader" | "action",
): Promise<OAuthAuthorizeTelemetryMetadata> {
  try {
    if (phase !== "loader") return { stateClass: "unknown" };
    const params = readAuthorizeParams(new URL(request.url).searchParams);
    return { stateClass: authorizeStateClass(params.state) };
  } catch {
    return { stateClass: "unknown" };
  }
}

function validatedAuthorizeTelemetry(
  params: AuthorizeRequestParams,
  validation: { scope: string; resource: string | null },
  principalId?: string,
): OAuthAuthorizeTelemetryMetadata {
  return {
    clientId: params.clientId,
    principalId,
    stateClass: authorizeStateClass(params.state),
    scope: validation.scope,
    resource: validation.resource ?? undefined,
  };
}

function authorizeDecision(value: string): "approve" | "deny" | "other" {
  if (value === "approve" || value === "deny") return value;
  return "other";
}

/**
 * Validate the client + redirect URI before we trust them enough to redirect
 * back to. A bad client/redirect surfaces an on-site error (never an open
 * redirect); other problems are reported to the client via `redirect_uri`.
 */
async function validateClientRedirect(
  db: Database,
  params: AuthorizeRequestParams,
): Promise<
  | { ok: true; clientName: string | null }
  | { ok: false; code: "invalid_client" | "invalid_redirect_uri"; message: string }
> {
  const client = await getOAuthClient(db, params.clientId);
  if (!client) return { ok: false, code: "invalid_client", message: "Unknown OAuth client." };
  if (!params.redirectUri || !clientAllowsRedirect(client, params.redirectUri)) {
    return {
      ok: false,
      code: "invalid_redirect_uri",
      message: "The redirect URI is not registered for this client.",
    };
  }
  return { ok: true, clientName: client.clientName };
}

function redirectBackWithError(params: AuthorizeRequestParams, code: string): Response {
  const url = new URL(params.redirectUri);
  url.searchParams.set("error", code);
  if (params.state) url.searchParams.set("state", params.state);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

function validS256CodeChallenge(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function normalizeAuthorizeResource(request: Request, env: OAuthEnv | null | undefined, resource: string) {
  if (!resource) return null;
  const expected = mcpResourceUrl(resolveIssuerOrigin(request.url, env?.SPOONJOY_BASE_URL));
  return resource === expected ? resource : "";
}

async function validateAuthorizeRequest(
  request: Request,
  db: Database,
  env: OAuthEnv | null | undefined,
  params: AuthorizeRequestParams,
): Promise<
  | { ok: true; clientName: string | null; scope: string; resource: string | null }
  | { ok: false; kind: "local"; code: string; message: string }
  | { ok: false; kind: "redirect"; code: string; resource?: string | null }
> {
  const validation = await validateClientRedirect(db, params);
  if (!validation.ok) return { ok: false, kind: "local", code: validation.code, message: validation.message };
  if (params.responseType !== "code") return { ok: false, kind: "redirect", code: "unsupported_response_type" };
  if (params.state.trim().length < 16) return { ok: false, kind: "redirect", code: "invalid_request" };
  if (params.codeChallengeMethod !== "S256" || !validS256CodeChallenge(params.codeChallenge)) {
    return { ok: false, kind: "redirect", code: "invalid_request" };
  }
  const resource = normalizeAuthorizeResource(request, env, params.resource);
  if (resource === "") return { ok: false, kind: "redirect", code: "invalid_target" };
  try {
    return { ok: true, clientName: validation.clientName, scope: normalizeScope(params.scope), resource };
  } catch {
    return { ok: false, kind: "redirect", code: "invalid_scope", resource };
  }
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

  const validation = await validateAuthorizeRequest(request, db, env, params);
  if (!validation.ok && validation.kind === "local") {
    return withOAuthAuthorizeTelemetry(
      { kind: "error", message: validation.message },
      {
        outcome: "client_error",
        errorCode: validation.code,
        stateClass: authorizeStateClass(params.state),
      },
    );
  }
  if (!validation.ok) {
    return withOAuthAuthorizeTelemetry(
      redirectBackWithError(params, validation.code),
      {
        outcome: "redirect_error",
        clientId: params.clientId,
        errorCode: validation.code,
        stateClass: authorizeStateClass(params.state),
        resource: validation.resource ?? undefined,
      },
    );
  }

  const userId = await getUserId(request, env);
  if (!userId) {
    const returnTo = `${url.pathname}${url.search}`;
    return withOAuthAuthorizeTelemetry(
      new Response(null, {
        status: 302,
        headers: { Location: `/login?redirectTo=${encodeURIComponent(returnTo)}` },
      }),
      {
        ...validatedAuthorizeTelemetry(params, validation),
        outcome: "login_redirect",
      },
    );
  }

  return withOAuthAuthorizeTelemetry(
    {
      kind: "consent",
      clientName: validation.clientName,
      scope: validation.scope,
      params: { ...params, scope: validation.scope, resource: validation.resource ?? "" },
    },
    {
      ...validatedAuthorizeTelemetry(params, validation, userId),
      outcome: "consent",
    },
  );
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
  const crossOrigin = crossOriginConsentResponse(request);
  if (crossOrigin) {
    return withOAuthAuthorizeTelemetry(crossOrigin, {
      outcome: "error",
      errorCode: "invalid_request",
      stateClass: "unknown",
    });
  }

  let form: URLSearchParams;
  try {
    form = await readLimitedFormBody(request);
  } catch (error) {
    if (error instanceof OAuthError) {
      return withOAuthAuthorizeTelemetry(oauthErrorResponse(error), {
        outcome: "error",
        errorCode: error.code,
        stateClass: "unknown",
      });
    }
    return withOAuthAuthorizeTelemetry(
      Response.json({ error: "invalid_request", error_description: "Invalid form body" }, { status: 400 }),
      {
        outcome: "error",
        errorCode: "invalid_request",
        stateClass: "unknown",
      },
    );
  }
  const params = readAuthorizeParams(form);
  const decision = (form.get("decision") ?? "").toString();
  const userId = await getUserId(request, env);

  const validation = await validateAuthorizeRequest(request, db, env, params);
  if (!validation.ok && validation.kind === "local") {
    return withOAuthAuthorizeTelemetry(
      Response.json({ error: "invalid_request", error_description: validation.message }, { status: 400 }),
      {
        outcome: "client_error",
        errorCode: validation.code,
        principalId: userId || undefined,
        stateClass: authorizeStateClass(params.state),
      },
    );
  }
  if (!validation.ok) {
    return withOAuthAuthorizeTelemetry(
      redirectBackWithError(params, validation.code),
      {
        outcome: "redirect_error",
        clientId: params.clientId,
        principalId: userId || undefined,
        errorCode: validation.code,
        stateClass: authorizeStateClass(params.state),
        resource: validation.resource ?? undefined,
      },
    );
  }

  if (!userId) {
    const returnTo = `/oauth/authorize?${new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: params.responseType,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod,
      scope: params.scope,
      state: params.state,
      resource: params.resource,
    })}`;
    return withOAuthAuthorizeTelemetry(
      new Response(null, {
        status: 302,
        headers: { Location: `/login?redirectTo=${encodeURIComponent(returnTo)}` },
      }),
      {
        ...validatedAuthorizeTelemetry(params, validation),
        outcome: "login_redirect",
      },
    );
  }

  if (decision !== "approve") {
    return withOAuthAuthorizeTelemetry(
      redirectBackWithError(params, "access_denied"),
      {
        ...validatedAuthorizeTelemetry(params, validation, userId),
        outcome: "denied",
        decision: authorizeDecision(decision),
        errorCode: "access_denied",
      },
    );
  }

  const code = await createAuthorizationCode(db, {
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: validation.scope,
    resource: validation.resource,
  });

  const url = new URL(params.redirectUri);
  url.searchParams.set("code", code);
  if (params.state) url.searchParams.set("state", params.state);
  return withOAuthAuthorizeTelemetry(
    new Response(null, { status: 302, headers: { Location: url.toString() } }),
    {
      ...validatedAuthorizeTelemetry(params, validation, userId),
      outcome: "approved",
      decision: "approve",
    },
  );
}
