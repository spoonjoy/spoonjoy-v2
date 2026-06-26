import {
  API_V1_ERROR_STATUS,
  API_V1_DISCOVERY_DATA,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
  type ApiV1ErrorCode,
} from "~/lib/api-v1-contract.server";
import { OAUTH_ACCESS_TOKEN_TTL_SECONDS } from "~/lib/oauth-server.server";

type JsonSchema = Record<string, unknown>;
type HttpMethod = typeof API_V1_RESOURCES[number]["methods"][number];
type ResourcePath = typeof API_V1_RESOURCES[number]["path"];
type OperationAuth = "optional" | "bearer";
type CredentialMode = "anonymous" | "session" | "bearer" | "oauth_pkce";

interface OperationConfig {
  operationId: string;
  tags: string[];
  summary: string;
  auth: OperationAuth;
  scopes: string[];
  success: Record<number, string>;
  errors: ApiV1ErrorCode[];
  errorScopes?: string[];
  parameters?: unknown[];
  requestBody?: string;
  requestBodyRequired?: boolean;
}

interface BuildOpenApiOptions {
  serverUrl?: string;
}

const jsonContent = (schema: JsonSchema, example: unknown) => ({
  "application/json": {
    schema,
    examples: {
      example: { value: example },
    },
  },
});

const jsonContentExamples = (schema: JsonSchema, examples: Record<string, unknown>) => ({
  "application/json": {
    schema,
    examples: Object.fromEntries(
      Object.entries(examples).map(([name, value]) => [name, { value }]),
    ),
  },
});

const formContentExamples = (schema: JsonSchema, examples: Record<string, unknown>) => ({
  "application/x-www-form-urlencoded": {
    schema,
    examples: Object.fromEntries(
      Object.entries(examples).map(([name, value]) => [name, { value }]),
    ),
  },
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const idSchema = { type: "string", minLength: 1 };
const shortTextSchema = { type: "string", minLength: 1, maxLength: 160 };
const dateTimeSchema = { type: "string", format: "date-time" };
const nullableDateTimeSchema = { type: ["string", "null"], format: "date-time" };
const nullableStringSchema = { type: ["string", "null"] };
const nullableNumberSchema = { type: ["number", "null"] };
const coverSourceTypeSchema = {
  type: ["string", "null"],
  enum: ["ai-placeholder", "chef-upload", "import", "spoon", null],
  description: "Active cover provenance source. Null when the recipe has no active public cover.",
};
const coverVariantSchema = {
  type: ["string", "null"],
  enum: ["image", "stylized", null],
  description: "Active cover variant: image is verbatim/pure AI/imported display; stylized is an editorialized chef photo. Null when no active cover is available.",
};
const recipeCoverSourceTypeSchema = {
  type: "string",
  enum: ["ai-placeholder", "chef-upload", "import", "spoon"],
};
const recipeCoverStatusSchema = {
  type: "string",
  enum: ["processing", "ready", "failed", "archived"],
};
const recipeCoverGenerationStatusSchema = {
  type: "string",
  enum: ["none", "processing", "succeeded", "failed"],
};
const uriSchema = { type: "string", format: "uri" };
const redirectUriSchema = {
  ...uriSchema,
  description: "Exact OAuth redirect URI. Production callbacks must use HTTPS. HTTP is accepted only for localhost or 127.0.0.1 development loopback. Fragments, userinfo, wildcards, and custom schemes are rejected.",
};
const boundedNullableStringSchema = { type: ["string", "null"], maxLength: 160 };

const DEFAULT_SERVER_URL = "https://spoonjoy.app";

function serverUrlFor(options: BuildOpenApiOptions) {
  return (options.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function absoluteApiUrl(origin: string, path: string) {
  return `${origin}${path}`;
}

function objectSchema(required: string[], properties: Record<string, JsonSchema>, extra: Partial<JsonSchema> = {}): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
    ...extra,
  };
}

function arrayOf(schema: JsonSchema): JsonSchema {
  return { type: "array", items: schema };
}

function successEnvelope(dataSchema: JsonSchema): JsonSchema {
  return objectSchema(["ok", "requestId", "data"], {
    ok: { const: true },
    requestId: idSchema,
    data: dataSchema,
  });
}

const schemas = {
  ErrorDetails: { type: "object", additionalProperties: true },
  ErrorObject: objectSchema(["code", "message", "status"], {
    code: { type: "string", enum: Object.keys(API_V1_ERROR_STATUS) },
    message: { type: "string" },
    status: { type: "integer" },
    details: ref("ErrorDetails"),
  }),
  ErrorEnvelope: objectSchema(["ok", "requestId", "error"], {
    ok: { const: false },
    requestId: idSchema,
    error: ref("ErrorObject"),
  }),
  SuccessEnvelope: objectSchema(["ok", "requestId", "data"], {
    ok: { const: true },
    requestId: idSchema,
    data: { type: "object" },
  }),
  NativeContractData: objectSchema(["status", "resource", "message"], {
    status: { type: "string", enum: ["declared"] },
    resource: { type: "string" },
    message: { type: "string" },
  }),
  NativeContractEnvelope: successEnvelope(ref("NativeContractData")),
  NativeMutationRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    payload: {
      type: "object",
      additionalProperties: true,
      description: "Endpoint-specific payload. Unit-specific API tests replace this with exact schemas before handler success ships.",
    },
  }),
  OpenApiInfo: objectSchema(["title", "version", "description"], {
    title: { type: "string" },
    version: { type: "string" },
    description: { type: "string" },
  }),
  OpenApiServer: objectSchema(["url"], { url: { type: "string" } }),
  OpenApiDocument: objectSchema(["openapi", "info", "servers", "paths", "components"], {
    openapi: { const: "3.1.0" },
    info: ref("OpenApiInfo"),
    servers: arrayOf(ref("OpenApiServer")),
    paths: { type: "object", additionalProperties: true },
    components: { type: "object", additionalProperties: true },
    "x-oauth-scope-map": { type: "object", additionalProperties: true },
    "x-auth-flows": arrayOf({ type: "object", additionalProperties: true }),
    "x-client-scenarios": arrayOf({ type: "object", additionalProperties: true }),
    "x-current-capabilities": { type: "object", additionalProperties: true },
  }, { additionalProperties: true }),
  SdkOpenApiDocument: objectSchema(["openapi", "info", "servers", "paths", "components"], {
    openapi: { const: "3.1.0" },
    info: ref("OpenApiInfo"),
    servers: arrayOf(ref("OpenApiServer")),
    paths: { type: "object", additionalProperties: true },
    components: { type: "object", additionalProperties: true },
    "x-sdk-profile": { type: "object", additionalProperties: true },
  }, { additionalProperties: true }),
  ConnectorOpenApiDocument: objectSchema(["openapi", "info", "servers", "paths", "components"], {
    openapi: { const: "3.0.3" },
    info: ref("OpenApiInfo"),
    servers: arrayOf(ref("OpenApiServer")),
    paths: { type: "object", additionalProperties: true },
    components: { type: "object", additionalProperties: true },
    "x-connector-profile": { type: "object", additionalProperties: true },
  }, { additionalProperties: true }),
  OAuthRegisterRequest: objectSchema(["redirect_uris"], {
    client_name: { type: "string" },
    redirect_uris: arrayOf(redirectUriSchema),
    token_endpoint_auth_method: { const: "none" },
    grant_types: arrayOf({ type: "string", enum: ["authorization_code", "refresh_token"] }),
    response_types: arrayOf({ type: "string", enum: ["code"] }),
    scope: { type: "string", examples: ["kitchen:read", "shopping_list:read shopping_list:write"] },
    application_type: { type: "string", enum: ["web", "native"], description: "Accepted RFC 7591/OIDC client metadata. Spoonjoy stores redirect URIs and client_name; this field is accepted but not used." },
    client_uri: { ...uriSchema, description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    logo_uri: { ...uriSchema, description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    policy_uri: { ...uriSchema, description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    tos_uri: { ...uriSchema, description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    contacts: { ...arrayOf({ type: "string" }), description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    jwks_uri: { ...uriSchema, description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    jwks: { type: "object", additionalProperties: true, description: "Accepted RFC 7591 metadata; not used because Spoonjoy public clients use PKCE and no client secret." },
    sector_identifier_uri: { ...uriSchema, description: "Accepted OIDC metadata; not used by Spoonjoy." },
    subject_type: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    software_id: { type: "string", description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    software_version: { type: "string", description: "Accepted RFC 7591 metadata; not used by Spoonjoy." },
    default_max_age: { type: "integer", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    require_auth_time: { type: "boolean", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    default_acr_values: { ...arrayOf({ type: "string" }), description: "Accepted OIDC metadata; not used by Spoonjoy." },
    initiate_login_uri: { ...uriSchema, description: "Accepted OIDC metadata; not used by Spoonjoy." },
    request_uris: { ...arrayOf(uriSchema), description: "Accepted OIDC metadata; not used by Spoonjoy." },
    id_token_signed_response_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    id_token_encrypted_response_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    id_token_encrypted_response_enc: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    userinfo_signed_response_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    userinfo_encrypted_response_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    userinfo_encrypted_response_enc: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    request_object_signing_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    request_object_encryption_alg: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    request_object_encryption_enc: { type: "string", description: "Accepted OIDC metadata; not used by Spoonjoy." },
    token_endpoint_auth_signing_alg: { type: "string", description: "Accepted RFC 7591 metadata; not used because Spoonjoy public clients use token_endpoint_auth_method: none." },
  }),
  OAuthRegisterResponse: objectSchema(["client_id", "redirect_uris", "token_endpoint_auth_method", "grant_types", "response_types"], {
    client_id: idSchema,
    client_name: { type: "string" },
    redirect_uris: arrayOf(redirectUriSchema),
    token_endpoint_auth_method: { const: "none" },
    grant_types: arrayOf({ type: "string", enum: ["authorization_code", "refresh_token"] }),
    response_types: arrayOf({ type: "string", enum: ["code"] }),
  }),
  OAuthTokenCodeRequest: objectSchema(["grant_type", "client_id", "redirect_uri", "code", "code_verifier"], {
    grant_type: { const: "authorization_code" },
    client_id: idSchema,
    redirect_uri: redirectUriSchema,
    code: { type: "string", minLength: 1 },
    code_verifier: { type: "string", minLength: 43 },
  }),
  OAuthTokenRefreshRequest: objectSchema(["grant_type", "client_id", "refresh_token"], {
    grant_type: { const: "refresh_token" },
    client_id: idSchema,
    refresh_token: { type: "string", pattern: "^ort_" },
  }),
  OAuthRevokeRequest: objectSchema(["token"], {
    token: { type: "string", pattern: "^ort_" },
    client_id: { ...idSchema, description: "Recommended. Spoonjoy checks it when present; the refresh token itself still identifies the public client so clients can disconnect even if client_id storage is lost." },
    token_type_hint: { type: "string", enum: ["refresh_token"] },
  }),
  OAuthTokenResponse: objectSchema(["access_token", "refresh_token", "token_type", "expires_in", "scope"], {
    access_token: { type: "string", pattern: "^sj_" },
    refresh_token: { type: "string", pattern: "^ort_" },
    token_type: { const: "Bearer" },
    expires_in: { type: "integer", const: OAUTH_ACCESS_TOKEN_TTL_SECONDS },
    scope: { type: "string" },
  }),
  OAuthErrorResponse: objectSchema(["error", "error_description"], {
    error: { type: "string" },
    error_description: { type: "string" },
  }),
  RateLimitResponse: objectSchema(["error", "message", "retryAfterSeconds"], {
    error: { type: "string", const: "rate_limited" },
    message: { type: "string" },
    retryAfterSeconds: { type: "integer", minimum: 1 },
  }),
  AgentStartRequest: objectSchema([], {
    agentName: { type: "string" },
    scopes: { type: "string", examples: ["shopping_list:read shopping_list:write", "kitchen:read kitchen:write"] },
  }),
  AgentStartData: objectSchema(["deviceCode", "userCode", "authorizationUrl", "verificationUri", "verificationUriComplete", "expiresAt", "expiresIn", "interval", "message"], {
    deviceCode: { type: "string", pattern: "^sjdc_" },
    userCode: { type: "string" },
    authorizationUrl: uriSchema,
    verificationUri: uriSchema,
    verificationUriComplete: uriSchema,
    expiresAt: dateTimeSchema,
    expiresIn: { type: "integer", const: 600 },
    interval: { type: "integer", const: 2 },
    message: { type: "string" },
  }),
  AgentStartEnvelope: objectSchema(["ok", "data"], {
    ok: { const: true },
    data: ref("AgentStartData"),
  }),
  AgentPollRequest: objectSchema(["deviceCode"], {
    deviceCode: { type: "string", pattern: "^sjdc_" },
    tokenName: { type: "string" },
  }),
  AgentCredentialMetadata: objectSchema(["id", "name", "tokenPrefix", "scopes", "createdAt", "expiresAt"], {
    id: idSchema,
    name: { type: "string" },
    tokenPrefix: { type: "string" },
    scopes: arrayOf({ type: "string" }),
    createdAt: dateTimeSchema,
    expiresAt: nullableDateTimeSchema,
  }),
  AgentPollData: objectSchema(["status", "expiresAt", "message"], {
    status: { type: "string", enum: ["pending", "approved", "denied", "expired", "claimed"] },
    expiresAt: dateTimeSchema,
    authorizationUrl: uriSchema,
    verificationUri: uriSchema,
    verificationUriComplete: uriSchema,
    userCode: { type: "string" },
    token: { type: "string", pattern: "^sj_" },
    credential: ref("AgentCredentialMetadata"),
    message: { type: "string" },
  }),
  AgentPollEnvelope: objectSchema(["ok", "data"], {
    ok: { const: true },
    data: ref("AgentPollData"),
  }),
  LegacyToolEnvelope: objectSchema(["ok", "data"], {
    ok: { const: true },
    data: { type: "object", additionalProperties: true },
  }),
  LegacyToolErrorEnvelope: objectSchema(["ok", "error"], {
    ok: { const: false },
    error: objectSchema(["message", "status"], {
      message: { type: "string" },
      status: { type: "integer" },
    }),
  }),
  McpJsonRpcRequest: objectSchema(["jsonrpc", "id", "method"], {
    jsonrpc: { const: "2.0" },
    id: { type: ["string", "number"] },
    method: { type: "string" },
    params: { type: "object", additionalProperties: true },
  }),
  McpJsonRpcResponse: objectSchema(["jsonrpc", "id"], {
    jsonrpc: { const: "2.0" },
    id: { type: ["string", "number", "null"] },
    result: { type: "object", additionalProperties: true },
    error: { type: "object", additionalProperties: true },
  }),
  ChefSummary: objectSchema(["id", "username"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
  }),
  ApiPrincipalSummary: objectSchema(["id", "username", "source"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
    source: { type: "string", enum: ["session", "bearer", "environment"] },
  }),
  RecipeIngredient: objectSchema(["id", "name", "quantity", "unit"], {
    id: idSchema,
    name: { type: "string", description: "Author-provided ingredient name. Render as text, not HTML." },
    quantity: { type: "number", description: "Author-provided numeric quantity. API v1 does not expose a separate free-form display line or conversion metadata." },
    unit: { ...nullableStringSchema, description: "Author-provided free-form display unit. Null when unset; not a canonical unit registry value." },
  }),
  RecipeStepOutputUse: objectSchema(["id", "inputStepNum", "outputStepNum", "outputOfStep"], {
    id: idSchema,
    inputStepNum: { type: "integer", description: "Step number that consumes output from another step." },
    outputStepNum: { type: "integer", description: "Step number whose output is used by inputStepNum." },
    outputOfStep: objectSchema(["stepNum", "stepTitle"], {
      stepNum: { type: "integer" },
      stepTitle: nullableStringSchema,
    }),
  }),
  RecipeStep: objectSchema(["id", "stepNum", "stepTitle", "description", "duration", "ingredients", "usingSteps"], {
    id: idSchema,
    stepNum: { type: "integer", description: "Display order. Recipe detail responses return steps in ascending stepNum order." },
    stepTitle: { ...nullableStringSchema, description: "Optional author-provided step heading. Render as text, not HTML." },
    description: { type: "string", description: "Author-provided instruction text. Render as text, not HTML." },
    duration: { type: ["integer", "null"], description: "Minutes, when the author supplied a duration. Null means no duration was set." },
    ingredients: { ...arrayOf(ref("RecipeIngredient")), description: "Ingredients attached to this step, in API order. API v1 does not expose a separate ingredient display-text field." },
    usingSteps: { ...arrayOf(ref("RecipeStepOutputUse")), description: "Prior recipe steps whose outputs this step uses, ordered by outputStepNum." },
  }),
  RecipeSpoonChef: objectSchema(["id", "photoUrl", "username"], {
    id: idSchema,
    photoUrl: nullableStringSchema,
    username: { type: "string" },
  }),
  RecipeSpoon: objectSchema(["chefId", "cookedAt", "createdAt", "deletedAt", "id", "nextTime", "note", "photoUrl", "recipeId", "updatedAt"], {
    id: idSchema,
    chefId: idSchema,
    recipeId: idSchema,
    cookedAt: dateTimeSchema,
    photoUrl: nullableStringSchema,
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    deletedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  RecipeDetailRecentSpoon: objectSchema(["chef", "chefId", "cookedAt", "createdAt", "deletedAt", "id", "nextTime", "note", "photoUrl", "recipeId", "updatedAt"], {
    id: idSchema,
    chefId: idSchema,
    recipeId: idSchema,
    cookedAt: dateTimeSchema,
    photoUrl: nullableStringSchema,
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    deletedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    chef: ref("RecipeSpoonChef"),
  }),
  CookbookLink: objectSchema(["id", "title", "href", "canonicalUrl"], {
    id: idSchema,
    title: { type: "string" },
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  SourceRecipeAttribution: objectSchema(["id", "title", "chef", "href", "canonicalUrl", "deleted"], {
    id: idSchema,
    title: nullableStringSchema,
    chef: { oneOf: [ref("ChefSummary"), { type: "null" }] },
    href: nullableStringSchema,
    canonicalUrl: { type: ["string", "null"], format: "uri" },
    deleted: { type: "boolean" },
  }),
  RecipeAttribution: objectSchema(["creditText", "canonicalUrl", "sourceUrl", "sourceHost", "sourceRecipe"], {
    creditText: { type: "string" },
    canonicalUrl: uriSchema,
    sourceUrl: { ...nullableStringSchema, description: "User-provided provenance URL. Validate and allow-list schemes before rendering as a link." },
    sourceHost: nullableStringSchema,
    sourceRecipe: { oneOf: [ref("SourceRecipeAttribution"), { type: "null" }] },
  }),
  CookbookAttribution: objectSchema(["creditText", "canonicalUrl"], {
    creditText: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  RecipeSummary: objectSchema(["id", "title", "description", "servings", "chef", "coverImageUrl", "coverProvenanceLabel", "coverSourceType", "coverVariant", "href", "canonicalUrl", "attribution", "createdAt", "updatedAt"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    coverImageUrl: { ...nullableStringSchema, description: "Public cover image URL for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    coverProvenanceLabel: { ...nullableStringSchema, description: "Human-readable active cover provenance label such as Chef photo, Editorialized chef photo, Imported photo, or AI generated." },
    coverSourceType: coverSourceTypeSchema,
    coverVariant: coverVariantSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("RecipeAttribution"),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  RecipeDetail: objectSchema(["id", "title", "description", "servings", "chef", "coverImageUrl", "coverProvenanceLabel", "coverSourceType", "coverVariant", "href", "canonicalUrl", "attribution", "createdAt", "updatedAt", "steps", "cookbooks", "recentSpoons"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    coverImageUrl: { ...nullableStringSchema, description: "Public cover image URL for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    coverProvenanceLabel: { ...nullableStringSchema, description: "Human-readable active cover provenance label such as Chef photo, Editorialized chef photo, Imported photo, or AI generated." },
    coverSourceType: coverSourceTypeSchema,
    coverVariant: coverVariantSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("RecipeAttribution"),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    steps: { ...arrayOf(ref("RecipeStep")), description: "Recipe steps returned in ascending stepNum order." },
    cookbooks: arrayOf(ref("CookbookLink")),
    recentSpoons: { ...arrayOf(ref("RecipeDetailRecentSpoon")), description: "Latest non-deleted cook-log preview rows for the recipe. Use /api/v1/recipes/{id}/spoons for cursor pagination." },
  }),
  CookbookSummary: objectSchema(["id", "title", "chef", "recipeCount", "coverImageUrls", "href", "canonicalUrl", "attribution", "createdAt", "updatedAt"], {
    id: idSchema,
    title: { type: "string" },
    chef: ref("ChefSummary"),
    recipeCount: { type: "integer" },
    coverImageUrls: { ...arrayOf({ type: "string" }), description: "Public recipe cover image URLs for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("CookbookAttribution"),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  CookbookDetail: objectSchema(["id", "title", "chef", "recipeCount", "coverImageUrls", "href", "canonicalUrl", "attribution", "createdAt", "updatedAt", "recipes"], {
    id: idSchema,
    title: { type: "string" },
    chef: ref("ChefSummary"),
    recipeCount: { type: "integer" },
    coverImageUrls: { ...arrayOf({ type: "string" }), description: "Public recipe cover image URLs for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("CookbookAttribution"),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    recipes: { ...arrayOf(ref("RecipeSummary")), description: "Currently public, non-deleted recipe summaries in cookbook order." },
  }),
  ProfileSummary: objectSchema(["id", "username", "photoUrl", "joinedLabel", "href", "canonicalUrl"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
    photoUrl: nullableStringSchema,
    joinedLabel: { type: "string", examples: ["Joined Jun 2026"] },
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  ProfileLink: objectSchema(["id", "username", "href", "canonicalUrl"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  ProfileRecipe: objectSchema(["id", "title", "description", "servings", "coverImageUrl", "coverProvenanceLabel", "href", "canonicalUrl"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    coverImageUrl: nullableStringSchema,
    coverProvenanceLabel: nullableStringSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  ProfileCookbookRecipe: objectSchema(["id", "title", "coverImageUrl", "coverProvenanceLabel", "href", "canonicalUrl"], {
    id: idSchema,
    title: { type: "string" },
    coverImageUrl: nullableStringSchema,
    coverProvenanceLabel: nullableStringSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  ProfileCookbook: objectSchema(["id", "title", "recipeCount", "recipes", "href", "canonicalUrl"], {
    id: idSchema,
    title: { type: "string" },
    recipeCount: { type: "integer", minimum: 0, description: "Count of active, non-deleted linked recipes." },
    recipes: arrayOf(ref("ProfileCookbookRecipe")),
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  ProfileSpoonChef: objectSchema(["id", "username", "photoUrl"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
    photoUrl: nullableStringSchema,
  }),
  ProfileSpoonRecipe: objectSchema(["id", "title", "chefId"], {
    id: idSchema,
    title: { type: "string" },
    chefId: idSchema,
  }),
  ProfileRecentSpoon: objectSchema(["id", "cookedAt", "photoUrl", "note", "nextTime", "chef", "recipe", "coverImageUrl", "coverProvenanceLabel"], {
    id: idSchema,
    cookedAt: dateTimeSchema,
    photoUrl: nullableStringSchema,
    note: nullableStringSchema,
    nextTime: nullableStringSchema,
    chef: ref("ProfileSpoonChef"),
    recipe: ref("ProfileSpoonRecipe"),
    coverImageUrl: nullableStringSchema,
    coverProvenanceLabel: nullableStringSchema,
  }),
  UserProfileData: objectSchema(["profile", "isOwner", "recipes", "cookbooks", "recentSpoons", "fellowChefsCount", "kitchenVisitorsCount"], {
    profile: ref("ProfileSummary"),
    isOwner: { type: "boolean" },
    recipes: arrayOf(ref("ProfileRecipe")),
    cookbooks: arrayOf(ref("ProfileCookbook")),
    recentSpoons: arrayOf(ref("ProfileRecentSpoon")),
    fellowChefsCount: { type: "integer", minimum: 0 },
    kitchenVisitorsCount: { type: "integer", minimum: 0 },
  }),
  ProfileInteractionCounts: objectSchema(["spoons", "forks", "cookbookSaves"], {
    spoons: { type: "integer", minimum: 0 },
    forks: { type: "integer", minimum: 0 },
    cookbookSaves: { type: "integer", minimum: 0 },
  }),
  ProfileGraphRow: objectSchema(["chefId", "username", "photoUrl", "href", "canonicalUrl", "interactionCounts", "latestInteractionAt"], {
    chefId: idSchema,
    username: { type: "string", minLength: 1 },
    photoUrl: nullableStringSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
    interactionCounts: ref("ProfileInteractionCounts"),
    latestInteractionAt: dateTimeSchema,
  }),
  ProfileGraphData: objectSchema(["profile", "page", "pageSize", "total", "nextCursor", "rows"], {
    profile: ref("ProfileLink"),
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 50 },
    total: { type: "integer", minimum: 0 },
    nextCursor: nullableStringSchema,
    rows: arrayOf(ref("ProfileGraphRow")),
  }),
  SearchOwner: objectSchema(["id", "username"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
  }),
  SearchResult: objectSchema(["type", "id", "ownerId", "ownerUsername", "owner", "title", "subtitle", "snippet", "href", "canonicalUrl", "imageUrl", "score", "metadata"], {
    type: { type: "string", enum: ["recipe", "cookbook", "chef", "shopping-list-item"] },
    id: idSchema,
    ownerId: idSchema,
    ownerUsername: { type: "string", minLength: 1 },
    owner: ref("SearchOwner"),
    title: { type: "string" },
    subtitle: { type: "string" },
    snippet: { type: "string" },
    href: { type: "string" },
    canonicalUrl: uriSchema,
    imageUrl: nullableStringSchema,
    score: { type: "number" },
    metadata: { type: "object", additionalProperties: true },
  }),
  SearchData: objectSchema(["query", "scope", "limit", "isAuthenticated", "results"], {
    query: { type: "string" },
    scope: { type: "string", enum: ["all", "recipes", "cookbooks", "chefs", "shopping-list"] },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    isAuthenticated: { type: "boolean" },
    results: arrayOf(ref("SearchResult")),
  }),
  CredentialMetadata: objectSchema(["id", "name", "tokenPrefix", "scopes", "createdAt", "updatedAt", "lastUsedAt", "revokedAt", "expiresAt"], {
    id: idSchema,
    name: shortTextSchema,
    tokenPrefix: { type: "string" },
    scopes: arrayOf({ type: "string" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    lastUsedAt: nullableDateTimeSchema,
    revokedAt: nullableDateTimeSchema,
    expiresAt: nullableDateTimeSchema,
  }),
  NativeOAuthAccount: objectSchema(["provider", "providerUsername"], {
    provider: { type: "string", enum: ["apple", "github", "google"] },
    providerUsername: { type: "string" },
  }),
  NativePasskey: objectSchema(["id", "name", "transports", "createdAt"], {
    id: idSchema,
    name: nullableStringSchema,
    transports: nullableStringSchema,
    createdAt: nullableDateTimeSchema,
  }),
  NativeAccountWebHandoff: objectSchema(["method", "url", "onlineOnly"], {
    method: { type: "string", enum: ["GET"] },
    url: { type: "string" },
    onlineOnly: { type: "boolean", const: true },
  }),
  NativePasswordHandoff: objectSchema(["method", "url", "onlineOnly", "actions"], {
    method: { type: "string", enum: ["GET"] },
    url: { type: "string" },
    onlineOnly: { type: "boolean", const: true },
    actions: arrayOf({ type: "string", enum: ["changePassword", "removePassword", "setPassword"] }),
  }),
  NativePasskeyHandoff: objectSchema(["method", "url", "onlineOnly", "registrationOptionsUrl", "registrationVerifyUrl", "actions"], {
    method: { type: "string", enum: ["GET"] },
    url: { type: "string" },
    onlineOnly: { type: "boolean", const: true },
    registrationOptionsUrl: { type: "string" },
    registrationVerifyUrl: { type: "string" },
    actions: arrayOf({ type: "string", enum: ["addPasskey", "renamePasskey", "removePasskey"] }),
  }),
  NativeProviderHandoffs: objectSchema(["google", "github", "apple"], {
    google: ref("NativeAccountWebHandoff"),
    github: ref("NativeAccountWebHandoff"),
    apple: ref("NativeAccountWebHandoff"),
  }),
  NativeAccountHandoffs: objectSchema(["accountSettings", "password", "passkeys", "providerLinks"], {
    accountSettings: ref("NativeAccountWebHandoff"),
    password: ref("NativePasswordHandoff"),
    passkeys: ref("NativePasskeyHandoff"),
    providerLinks: ref("NativeProviderHandoffs"),
  }),
  NativeOAuthConnection: objectSchema(["id", "clientId", "clientName", "resource", "scopes", "createdAt", "refreshTokenCount", "accessTokenCount"], {
    id: idSchema,
    clientId: idSchema,
    clientName: nullableStringSchema,
    resource: nullableStringSchema,
    scopes: arrayOf({ type: "string" }),
    createdAt: dateTimeSchema,
    refreshTokenCount: { type: "integer", minimum: 1 },
    accessTokenCount: { type: "integer", minimum: 0 },
  }),
  NativeAccount: objectSchema(["id", "email", "username", "hasPassword", "photoUrl", "oauthAccounts", "passkeys", "handoffs", "apiCredentials", "oauthConnections"], {
    id: idSchema,
    email: { type: "string", format: "email" },
    username: { type: "string", minLength: 1 },
    hasPassword: { type: "boolean" },
    photoUrl: nullableStringSchema,
    oauthAccounts: arrayOf(ref("NativeOAuthAccount")),
    passkeys: arrayOf(ref("NativePasskey")),
    handoffs: ref("NativeAccountHandoffs"),
    apiCredentials: arrayOf(ref("CredentialMetadata")),
    oauthConnections: arrayOf(ref("NativeOAuthConnection")),
  }),
  NativeNotificationPreferences: objectSchema(["notifySpoonOnMyRecipe", "notifyForkOfMyRecipe", "notifyCookbookSaveOfMine", "notifyFellowChefOriginCook"], {
    notifySpoonOnMyRecipe: { type: "boolean" },
    notifyForkOfMyRecipe: { type: "boolean" },
    notifyCookbookSaveOfMine: { type: "boolean" },
    notifyFellowChefOriginCook: { type: "boolean" },
  }),
  NativeNotificationStatus: objectSchema(["pushSubscribed", "preferences"], {
    pushSubscribed: { type: "boolean" },
    preferences: ref("NativeNotificationPreferences"),
  }),
  NativeAccountSnapshotData: objectSchema(["me", "notifications"], {
    me: ref("NativeAccount"),
    notifications: ref("NativeNotificationStatus"),
  }),
  NativeAccountSnapshotEnvelope: successEnvelope(ref("NativeAccountSnapshotData")),
  NativeProfileRequest: objectSchema([], {
    email: { type: "string", format: "email" },
    username: { type: "string", minLength: 1, maxLength: 160 },
  }),
  ProfilePhotoUploadRequest: objectSchema(["photo"], {
    photo: { type: "string", format: "binary", description: "Profile image file. Accepted media types match the web profile-image allow-list, including GIF and excluding SVG." },
  }),
  NativeProfilePhotoAccount: objectSchema(["id", "photoUrl"], {
    id: idSchema,
    photoUrl: nullableStringSchema,
  }),
  NativeProfilePhotoData: objectSchema(["photoUrl", "me"], {
    photoUrl: nullableStringSchema,
    me: ref("NativeProfilePhotoAccount"),
  }),
  NativeProfilePhotoEnvelope: successEnvelope(ref("NativeProfilePhotoData")),
  NativeProfilePhotoRemoveData: objectSchema(["removed", "photoUrl", "me"], {
    removed: { type: "boolean" },
    photoUrl: { type: "null" },
    me: ref("NativeProfilePhotoAccount"),
  }),
  NativeProfilePhotoRemoveEnvelope: successEnvelope(ref("NativeProfilePhotoRemoveData")),
  NativeNotificationPreferencesRequest: objectSchema([], {
    notifySpoonOnMyRecipe: { type: "boolean" },
    notifyForkOfMyRecipe: { type: "boolean" },
    notifyCookbookSaveOfMine: { type: "boolean" },
    notifyFellowChefOriginCook: { type: "boolean" },
  }),
  NativeNotificationPreferencesData: objectSchema(["preferences"], {
    preferences: ref("NativeNotificationPreferences"),
  }),
  NativeNotificationPreferencesEnvelope: successEnvelope(ref("NativeNotificationPreferencesData")),
  NativeApnsDeviceRequest: objectSchema(["deviceId", "platform", "environment", "token"], {
    deviceId: shortTextSchema,
    platform: { type: "string", enum: ["ios", "ipados", "macos"] },
    environment: { type: "string", enum: ["development", "production"] },
    token: { type: "string", minLength: 1, maxLength: 4096, description: "Raw APNs device token. Spoonjoy stores only a SHA-256 hash plus tokenPrefix." },
    deviceName: nullableStringSchema,
    appVersion: nullableStringSchema,
  }),
  NativeApnsDevice: objectSchema(["id", "deviceId", "platform", "environment", "tokenPrefix", "deviceName", "appVersion", "enabledAt", "revokedAt", "lastRegisteredAt", "createdAt", "updatedAt"], {
    id: idSchema,
    deviceId: idSchema,
    platform: { type: "string", enum: ["ios", "ipados", "macos"] },
    environment: { type: "string", enum: ["development", "production"] },
    tokenPrefix: { type: "string" },
    deviceName: nullableStringSchema,
    appVersion: nullableStringSchema,
    enabledAt: dateTimeSchema,
    revokedAt: nullableDateTimeSchema,
    lastRegisteredAt: dateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  NativeApnsDeviceData: objectSchema(["created", "device"], {
    created: { type: "boolean" },
    device: ref("NativeApnsDevice"),
  }),
  NativeApnsDeviceEnvelope: successEnvelope(ref("NativeApnsDeviceData")),
  NativeApnsDeviceRevokeData: objectSchema(["revoked", "revokedCount", "device", "devices"], {
    revoked: { type: "boolean" },
    revokedCount: { type: "integer", minimum: 0 },
    device: ref("NativeApnsDevice"),
    devices: arrayOf(ref("NativeApnsDevice")),
  }),
  NativeApnsDeviceRevokeEnvelope: successEnvelope(ref("NativeApnsDeviceRevokeData")),
  NativeOAuthConnectionsData: objectSchema(["connections"], {
    connections: arrayOf(ref("NativeOAuthConnection")),
  }),
  NativeOAuthConnectionsEnvelope: successEnvelope(ref("NativeOAuthConnectionsData")),
  NativeOAuthConnectionDisconnectData: objectSchema(["disconnected", "connection"], {
    disconnected: { type: "boolean" },
    connection: ref("NativeOAuthConnection"),
  }),
  NativeOAuthConnectionDisconnectEnvelope: successEnvelope(ref("NativeOAuthConnectionDisconnectData")),
  NativeSyncFreshness: objectSchema(["accountId", "environment", "schemaVersion", "sourceEndpoint", "generatedAt", "lastValidatedAt"], {
    accountId: idSchema,
    environment: { type: "string", description: "Server environment namespace for the account-scoped cache." },
    schemaVersion: { type: "integer", minimum: 1 },
    sourceEndpoint: { const: "/api/v1/me/sync" },
    generatedAt: dateTimeSchema,
    lastValidatedAt: dateTimeSchema,
  }),
  NativeSyncProfile: objectSchema(["id", "email", "username", "photoUrl", "updatedAt"], {
    id: idSchema,
    email: { type: "string", format: "email" },
    username: { type: "string", minLength: 1 },
    photoUrl: nullableStringSchema,
    updatedAt: dateTimeSchema,
  }),
  NativeSyncNotificationPreferences: objectSchema(["userId", "notifySpoonOnMyRecipe", "notifyForkOfMyRecipe", "notifyCookbookSaveOfMine", "notifyFellowChefOriginCook", "updatedAt"], {
    userId: idSchema,
    notifySpoonOnMyRecipe: { type: "boolean" },
    notifyForkOfMyRecipe: { type: "boolean" },
    notifyCookbookSaveOfMine: { type: "boolean" },
    notifyFellowChefOriginCook: { type: "boolean" },
    updatedAt: dateTimeSchema,
  }),
  NativeSyncRecipeIngredient: objectSchema(["id", "name", "quantity", "unit"], {
    id: idSchema,
    name: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string" },
  }),
  NativeSyncRecipeStepOutputReference: objectSchema(["stepNum", "stepTitle"], {
    stepNum: { type: "integer" },
    stepTitle: nullableStringSchema,
  }),
  NativeSyncRecipeStepOutputUse: objectSchema(["id", "inputStepNum", "outputStepNum", "outputOfStep"], {
    id: idSchema,
    inputStepNum: { type: "integer" },
    outputStepNum: { type: "integer" },
    outputOfStep: ref("NativeSyncRecipeStepOutputReference"),
  }),
  NativeSyncRecipeStep: objectSchema(["id", "stepNum", "stepTitle", "description", "duration", "ingredients", "usingSteps"], {
    id: idSchema,
    stepNum: { type: "integer" },
    stepTitle: nullableStringSchema,
    description: { type: "string" },
    duration: { type: ["integer", "null"] },
    ingredients: arrayOf(ref("NativeSyncRecipeIngredient")),
    usingSteps: arrayOf(ref("NativeSyncRecipeStepOutputUse")),
  }),
  NativeSyncCookbookLink: objectSchema(["id", "title", "href", "canonicalUrl"], {
    id: idSchema,
    title: { type: "string" },
    href: { type: "string" },
    canonicalUrl: uriSchema,
  }),
  NativeSyncRecipe: objectSchema(["id", "title", "description", "servings", "chef", "coverImageUrl", "coverProvenanceLabel", "coverSourceType", "coverVariant", "href", "canonicalUrl", "attribution", "deletedAt", "createdAt", "updatedAt", "steps", "cookbooks", "recentSpoons"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    coverImageUrl: { ...nullableStringSchema, description: "Public cover image URL for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    coverProvenanceLabel: nullableStringSchema,
    coverSourceType: coverSourceTypeSchema,
    coverVariant: coverVariantSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("RecipeAttribution"),
    deletedAt: { type: "null" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    steps: arrayOf(ref("NativeSyncRecipeStep")),
    cookbooks: arrayOf(ref("NativeSyncCookbookLink")),
    recentSpoons: arrayOf(ref("RecipeDetailRecentSpoon")),
  }),
  NativeSyncCookbookRecipe: objectSchema(["id", "title", "description", "servings", "chef", "coverImageUrl", "coverProvenanceLabel", "coverSourceType", "coverVariant", "href", "canonicalUrl", "attribution", "createdAt", "updatedAt"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    coverImageUrl: { ...nullableStringSchema, description: "Public cover image URL for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    coverProvenanceLabel: nullableStringSchema,
    coverSourceType: coverSourceTypeSchema,
    coverVariant: coverVariantSchema,
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("RecipeAttribution"),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  NativeSyncCookbook: objectSchema(["id", "title", "chef", "recipeCount", "coverImageUrls", "href", "canonicalUrl", "attribution", "deletedAt", "createdAt", "updatedAt", "recipes"], {
    id: idSchema,
    title: { type: "string" },
    chef: ref("ChefSummary"),
    recipeCount: { type: "integer" },
    coverImageUrls: { ...arrayOf({ type: "string" }), description: "Public recipe cover image URLs for transient display. API v1 does not provide image alt text or a license to copy/store photos outside Spoonjoy." },
    href: { type: "string" },
    canonicalUrl: uriSchema,
    attribution: ref("CookbookAttribution"),
    deletedAt: { type: "null" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    recipes: arrayOf(ref("NativeSyncCookbookRecipe")),
  }),
  NativeSyncSpoon: objectSchema(["id", "chefId", "recipeId", "cookedAt", "photoUrl", "note", "nextTime", "deletedAt", "createdAt", "updatedAt"], {
    id: idSchema,
    chefId: idSchema,
    recipeId: idSchema,
    cookedAt: dateTimeSchema,
    photoUrl: nullableStringSchema,
    note: nullableStringSchema,
    nextTime: nullableStringSchema,
    deletedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  NativeSyncShoppingItem: objectSchema(["id", "shoppingListId", "name", "quantity", "unit", "checked", "checkedAt", "deletedAt", "categoryKey", "iconKey", "sortIndex", "updatedAt"], {
    id: idSchema,
    shoppingListId: idSchema,
    name: { type: "string" },
    quantity: nullableNumberSchema,
    unit: boundedNullableStringSchema,
    checked: { type: "boolean" },
    checkedAt: nullableDateTimeSchema,
    deletedAt: nullableDateTimeSchema,
    categoryKey: boundedNullableStringSchema,
    iconKey: boundedNullableStringSchema,
    sortIndex: { type: "integer" },
    updatedAt: dateTimeSchema,
  }),
  NativeSyncTombstone: objectSchema(["resourceType", "resourceId", "parentResourceId", "title", "deletedAt", "updatedAt"], {
    resourceType: { type: "string", enum: ["recipe", "cookbook", "spoon", "shoppingItem"] },
    resourceId: idSchema,
    parentResourceId: nullableStringSchema,
    title: nullableStringSchema,
    deletedAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  NativeSyncEntryPayload: {
    oneOf: [
      ref("NativeSyncProfile"),
      ref("NativeSyncNotificationPreferences"),
      ref("NativeSyncRecipe"),
      ref("NativeSyncCookbook"),
      ref("NativeSyncSpoon"),
      ref("NativeSyncShoppingItem"),
      { type: "null" },
    ],
  },
  NativeSyncEntry: objectSchema(["action", "kind", "resourceId", "updatedAt", "payload", "tombstone"], {
    action: { type: "string", enum: ["upsert", "delete"] },
    kind: { type: "string", enum: ["profile", "notificationPreferences", "recipe", "cookbook", "spoon", "shoppingItem"] },
    resourceId: idSchema,
    updatedAt: dateTimeSchema,
    payload: ref("NativeSyncEntryPayload"),
    tombstone: { oneOf: [ref("NativeSyncTombstone"), { type: "null" }] },
  }),
  NativeSyncData: objectSchema(["freshness", "entries", "nextCursor", "hasMore"], {
    freshness: ref("NativeSyncFreshness"),
    entries: arrayOf(ref("NativeSyncEntry")),
    nextCursor: { type: "string", description: "Opaque native sync cursor. Store only after applying every entry in the returned page." },
    hasMore: { type: "boolean" },
  }),
  NativeSyncEnvelope: successEnvelope(ref("NativeSyncData")),
  ShoppingItem: objectSchema(["id", "name", "quantity", "unit", "checked", "checkedAt", "deletedAt", "categoryKey", "iconKey", "sortIndex", "updatedAt"], {
    id: idSchema,
    name: shortTextSchema,
    quantity: nullableNumberSchema,
    unit: boundedNullableStringSchema,
    checked: { type: "boolean" },
    checkedAt: nullableDateTimeSchema,
    deletedAt: nullableDateTimeSchema,
    categoryKey: boundedNullableStringSchema,
    iconKey: boundedNullableStringSchema,
    sortIndex: { type: "integer" },
    updatedAt: dateTimeSchema,
  }),
  ShoppingList: objectSchema(["id", "chef", "items", "updatedAt"], {
    id: idSchema,
    chef: ref("ChefSummary"),
    items: arrayOf(ref("ShoppingItem")),
    updatedAt: dateTimeSchema,
  }),
  MutationMetadata: objectSchema(["clientMutationId", "replayed"], {
    clientMutationId: shortTextSchema,
    replayed: { type: "boolean" },
  }),
  RecipeSpoonListItem: objectSchema(["chef", "chefId", "cookedAt", "coverGenerationStatus", "coverImageUrl", "coverProvenanceLabel", "coverSourceType", "coverStatus", "coverVariant", "createdAt", "deletedAt", "id", "nextTime", "note", "photoUrl", "recipeId", "updatedAt"], {
    id: idSchema,
    chefId: idSchema,
    recipeId: idSchema,
    cookedAt: dateTimeSchema,
    photoUrl: nullableStringSchema,
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    deletedAt: nullableDateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    chef: ref("RecipeSpoonChef"),
    coverImageUrl: nullableStringSchema,
    coverProvenanceLabel: nullableStringSchema,
    coverSourceType: coverSourceTypeSchema,
    coverVariant: coverVariantSchema,
    coverStatus: { type: ["string", "null"], enum: ["processing", "ready", "failed", "archived", null] },
    coverGenerationStatus: { type: ["string", "null"], enum: ["none", "processing", "succeeded", "failed", null] },
  }),
  RecipeSpoonListData: objectSchema(["cursor", "hasMore", "limit", "nextCursor", "recipeId", "spoons"], {
    recipeId: idSchema,
    limit: { type: "integer", minimum: 1, maximum: 50 },
    cursor: nullableStringSchema,
    nextCursor: nullableStringSchema,
    hasMore: { type: "boolean" },
    spoons: arrayOf(ref("RecipeSpoonListItem")),
  }),
  RecipeSpoonNotifications: objectSchema(["fellowChefOriginCook", "spoonOnMyRecipe"], {
    spoonOnMyRecipe: { type: "string", enum: ["queued", "skipped", "unavailable"] },
    fellowChefOriginCook: { type: "string", enum: ["queued", "skipped", "unavailable"] },
  }),
  CreateRecipeSpoonData: objectSchema(["cover", "isOriginCook", "mutation", "notifications", "spoon"], {
    spoon: ref("RecipeSpoon"),
    isOriginCook: { type: "boolean" },
    cover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    notifications: ref("RecipeSpoonNotifications"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateRecipeSpoonData: objectSchema(["cover", "mutation", "spoon"], {
    spoon: ref("RecipeSpoon"),
    cover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    mutation: ref("MutationMetadata"),
  }),
  DeleteRecipeSpoonData: objectSchema(["deleted", "mutation", "spoon"], {
    deleted: { const: true },
    spoon: ref("RecipeSpoon"),
    mutation: ref("MutationMetadata"),
  }),
  RecipeCover: objectSchema(["activeVariant", "archivedAt", "createdAt", "createdById", "displayUrl", "failureReason", "generationStatus", "id", "imageUrl", "provenanceLabel", "recipeId", "sourceImageUrl", "sourceSpoonId", "sourceType", "status", "stylizedImageUrl"], {
    id: idSchema,
    recipeId: idSchema,
    imageUrl: { type: "string", description: "Private lifecycle responses keep Spoonjoy photo URLs relative when stored that way." },
    stylizedImageUrl: nullableStringSchema,
    displayUrl: nullableStringSchema,
    activeVariant: coverVariantSchema,
    provenanceLabel: nullableStringSchema,
    sourceType: recipeCoverSourceTypeSchema,
    sourceSpoonId: nullableStringSchema,
    createdById: nullableStringSchema,
    archivedAt: nullableDateTimeSchema,
    generationStatus: recipeCoverGenerationStatusSchema,
    failureReason: nullableStringSchema,
    sourceImageUrl: nullableStringSchema,
    status: recipeCoverStatusSchema,
    createdAt: dateTimeSchema,
  }),
  RecipeCoverSpoonImageChef: objectSchema(["id", "photoUrl", "username"], {
    id: idSchema,
    photoUrl: nullableStringSchema,
    username: { type: "string" },
  }),
  RecipeCoverSpoonImage: objectSchema(["chef", "chefId", "cookedAt", "createdAt", "id", "photoUrl", "recipeId", "updatedAt"], {
    id: idSchema,
    recipeId: idSchema,
    chefId: idSchema,
    photoUrl: { type: "string" },
    cookedAt: dateTimeSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    chef: ref("RecipeCoverSpoonImageChef"),
  }),
  RecipeCoverPagination: objectSchema(["limit", "offset", "count", "hasMore"], {
    limit: { type: "integer", minimum: 1, maximum: 50 },
    offset: { type: "integer", minimum: 0 },
    count: { type: "integer", minimum: 0 },
    hasMore: { type: "boolean" },
  }),
  RecipeCoverListData: objectSchema(["activeCover", "covers", "pagination", "spoonImages"], {
    activeCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    covers: arrayOf(ref("RecipeCover")),
    pagination: ref("RecipeCoverPagination"),
    spoonImages: arrayOf(ref("RecipeCoverSpoonImage")),
  }),
  ProviderSecretBlocker: objectSchema(["blocked", "capability", "command", "domain", "outputPath", "ownerAction", "reason"], {
    blocked: { const: true },
    capability: { const: "ProviderSecret" },
    command: { type: "string" },
    domain: { type: "string", enum: ["recipe-covers", "recipe-import"] },
    outputPath: { type: "string" },
    ownerAction: { type: "string" },
    reason: { type: "string" },
  }),
  RecipeCoverMutationData: objectSchema(["activeCover", "blockers", "createdCover", "generationStatus", "mutation", "nextActions", "previousActiveCover", "warnings"], {
    activeCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    previousActiveCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    createdCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    generationStatus: recipeCoverGenerationStatusSchema,
    warnings: arrayOf({ type: "string" }),
    blockers: arrayOf(ref("ProviderSecretBlocker")),
    nextActions: arrayOf({ type: "string" }),
    mutation: ref("MutationMetadata"),
  }),
  ActiveRecipeCoverMutationData: objectSchema(["activeCover", "archivedCover", "blockers", "mutation", "nextActions", "previousActiveCover", "warnings"], {
    activeCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    previousActiveCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    archivedCover: { oneOf: [ref("RecipeCover"), { type: "null" }] },
    warnings: arrayOf({ type: "string" }),
    blockers: arrayOf(ref("ProviderSecretBlocker")),
    nextActions: arrayOf({ type: "string" }),
    mutation: ref("MutationMetadata"),
  }),
  RecipeImageUploadRequest: objectSchema(["clientMutationId", "image"], {
    clientMutationId: shortTextSchema,
    image: { type: "string", format: "binary", description: "Recipe cover image file. Accepted media types are JPG, PNG, and WebP." },
    activate: { type: "boolean" },
    generateEditorial: { type: "boolean", description: "Defaults to true. When provider secrets are missing, the raw cover remains usable and the response includes a ProviderSecret blocker." },
  }),
  CreateRecipeCoverRequest: objectSchema(["clientMutationId", "imageUrl"], {
    clientMutationId: shortTextSchema,
    imageUrl: { type: "string", description: "Owner-owned Spoonjoy uploaded image URL under /photos/recipes/{ownerId}/... or /photos/spoons/{ownerId}/..." },
    activate: { type: "boolean" },
    generateEditorial: { type: "boolean", description: "Defaults to true." },
  }),
  ActivateRecipeCoverRequest: objectSchema(["clientMutationId", "variant"], {
    clientMutationId: shortTextSchema,
    variant: { type: "string", enum: ["image", "stylized"] },
  }),
  ArchiveRecipeCoverRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    replacementCoverId: nullableStringSchema,
    replacementVariant: coverVariantSchema,
    confirmNoCover: { type: "boolean" },
    deleteSafeObjects: { type: "boolean", description: "Accepted for client intent tracking; object deletion is not implemented yet and returns a warning." },
  }),
  RegenerateRecipeCoverRequest: objectSchema(["clientMutationId", "coverId"], {
    clientMutationId: shortTextSchema,
    coverId: idSchema,
    activateWhenReady: { type: "boolean" },
  }),
  RecipeCoverFromSpoonRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    activate: { type: "boolean" },
    generateEditorial: { type: "boolean", description: "Defaults to true." },
  }),
  RecipeImportUrlSource: objectSchema(["type", "url"], {
    type: { const: "url" },
    url: uriSchema,
  }),
  RecipeImportVideoUrlSource: objectSchema(["type", "url"], {
    type: { const: "video-url" },
    url: uriSchema,
  }),
  RecipeImportTextSource: objectSchema(["type", "text"], {
    type: { const: "text" },
    text: { type: "string", minLength: 1, description: "Plain-text recipe content captured from native paste, share, OCR, or dictated input." },
    url: { type: ["string", "null"], format: "uri" },
  }),
  RecipeImportJsonLdSource: objectSchema(["type", "jsonLd"], {
    type: { const: "json-ld" },
    jsonLd: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "array", items: { type: "object", additionalProperties: true } },
      ],
      description: "schema.org Recipe JSON-LD captured by a native extension or share flow.",
    },
    url: { type: ["string", "null"], format: "uri" },
  }),
  RecipeImportRequest: objectSchema(["clientMutationId", "source"], {
    clientMutationId: shortTextSchema,
    source: {
      oneOf: [
        ref("RecipeImportUrlSource"),
        ref("RecipeImportTextSource"),
        ref("RecipeImportJsonLdSource"),
        ref("RecipeImportVideoUrlSource"),
      ],
    },
  }),
  RecipeImportInfo: objectSchema(["confidence", "coverPending", "existingRecipeId", "inputType", "source"], {
    inputType: { type: "string", enum: ["url", "text", "json-ld", "video-url"] },
    source: { type: ["string", "null"], enum: ["json-ld", "llm", "mixed", "video-oembed-llm", null] },
    confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
    existingRecipeId: nullableStringSchema,
    coverPending: { type: "boolean" },
  }),
  RecipeImportMutationData: objectSchema(["blockers", "import", "mutation", "nextActions", "recipe", "warnings"], {
    recipe: { oneOf: [ref("RecipeDetail"), { type: "null" }] },
    import: ref("RecipeImportInfo"),
    blockers: arrayOf(ref("ProviderSecretBlocker")),
    warnings: arrayOf({ type: "string" }),
    nextActions: arrayOf({ type: "string" }),
    mutation: ref("MutationMetadata"),
  }),
  CreateRecipeSpoonRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    cookedAt: dateTimeSchema,
    photoUrl: { ...nullableStringSchema, description: "Optional owner-owned Spoonjoy spoon photo URL under /photos/spoons/{chefId}/..." },
    useAsRecipeCover: { type: "boolean", description: "Owners can opt a spoon photo into recipe cover creation. Non-owner opt-ins are ignored." },
  }),
  CreateRecipeSpoonPhotoUploadRequest: objectSchema(["clientMutationId", "photo"], {
    clientMutationId: shortTextSchema,
    photo: { type: "string", format: "binary", description: "Spoon photo file. Accepted media types are JPG, PNG, and WebP." },
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    cookedAt: dateTimeSchema,
    useAsRecipeCover: { type: "boolean", description: "Owners can opt a spoon photo into recipe cover creation. Non-owner opt-ins are ignored." },
  }),
  UpdateRecipeSpoonRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    note: boundedNullableStringSchema,
    nextTime: boundedNullableStringSchema,
    cookedAt: dateTimeSchema,
    photoUrl: { ...nullableStringSchema, description: "Optional owner-owned Spoonjoy spoon photo URL under /photos/spoons/{chefId}/..." },
  }),
  DeleteRecipeSpoonRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  CreateCookbookRequest: objectSchema(["clientMutationId", "title"], {
    clientMutationId: shortTextSchema,
    title: { type: "string", minLength: 1, maxLength: 200 },
  }),
  UpdateCookbookRequest: objectSchema(["clientMutationId", "title"], {
    clientMutationId: shortTextSchema,
    title: { type: "string", minLength: 1, maxLength: 200 },
  }),
  DeleteCookbookRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  CookbookRecipeMutationRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  CreateTokenRequest: objectSchema(["name"], {
    name: shortTextSchema,
    scopes: {
      oneOf: [
        { type: "string" },
        arrayOf({ type: "string" }),
      ],
    },
  }),
  CreateShoppingItemRequest: objectSchema(["clientMutationId", "name"], {
    clientMutationId: shortTextSchema,
    name: shortTextSchema,
    quantity: { type: "number", exclusiveMinimum: 0 },
    unit: boundedNullableStringSchema,
    categoryKey: boundedNullableStringSchema,
    iconKey: boundedNullableStringSchema,
  }),
  CheckShoppingItemRequest: objectSchema(["clientMutationId", "checked"], {
    clientMutationId: shortTextSchema,
    checked: { type: "boolean" },
  }),
  DeleteShoppingItemRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  AddRecipeToShoppingListRequest: objectSchema(["clientMutationId", "recipeId"], {
    clientMutationId: shortTextSchema,
    recipeId: idSchema,
    scaleFactor: { type: "number", exclusiveMinimum: 0, default: 1 },
  }),
  ClearShoppingItemsRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  DiscoveryData: objectSchema(["app", "version", "status", "docsUrl", "openapiUrl", "sdkOpenapiUrl", "connectorOpenapiUrl", "resources", "auth"], {
    app: { const: "spoonjoy" },
    version: { const: "v1" },
    status: { const: "ok" },
    docsUrl: { type: "string" },
    openapiUrl: { type: "string" },
    sdkOpenapiUrl: { type: "string" },
    connectorOpenapiUrl: { type: "string" },
    resources: arrayOf({ type: "object" }),
    auth: { type: "object" },
  }),
  HealthData: objectSchema(["ok", "version", "authenticated", "principal", "scopes"], {
    ok: { const: true },
    version: { const: "v1" },
    authenticated: { type: "boolean" },
    principal: { oneOf: [ref("ApiPrincipalSummary"), { type: "null" }] },
    scopes: arrayOf({ type: "string" }),
  }),
  RecipeListData: objectSchema(["query", "limit", "cursor", "nextCursor", "hasMore", "recipes"], {
    query: nullableStringSchema,
    limit: { type: "integer" },
    cursor: nullableStringSchema,
    nextCursor: nullableStringSchema,
    hasMore: { type: "boolean" },
    recipes: arrayOf(ref("RecipeSummary")),
  }),
  RecipeDetailData: objectSchema(["recipe"], { recipe: ref("RecipeDetail") }),
  RecipeIngredientInput: objectSchema(["quantity", "unit", "name"], {
    quantity: { type: "number", minimum: 0.001, maximum: 99999 },
    unit: { type: "string", minLength: 1, maxLength: 50 },
    name: { type: "string", minLength: 1, maxLength: 100 },
  }),
  RecipeStepInput: objectSchema(["description"], {
    stepTitle: { type: ["string", "null"], maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 5000 },
    duration: { type: ["integer", "null"], minimum: 1 },
    ingredients: arrayOf(ref("RecipeIngredientInput")),
    outputStepNums: arrayOf({ type: "integer", minimum: 1, description: "Step numbers whose outputs this newly-created step uses. Values must reference previous steps in this create payload." }),
  }),
  CreateRecipeRequest: objectSchema(["clientMutationId", "title"], {
    clientMutationId: shortTextSchema,
    title: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: ["string", "null"], maxLength: 2000 },
    servings: { type: ["string", "null"], maxLength: 100 },
    steps: arrayOf(ref("RecipeStepInput")),
  }),
  UpdateRecipeRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    title: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: ["string", "null"], maxLength: 2000 },
    servings: { type: ["string", "null"], maxLength: 100 },
  }),
  DeleteRecipeRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  ForkRecipeRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    title: { type: ["string", "null"], minLength: 1, maxLength: 200 },
  }),
  CreateRecipeStepRequest: objectSchema(["clientMutationId", "description"], {
    clientMutationId: shortTextSchema,
    stepNum: { type: "integer", minimum: 1, description: "Optional next step number assertion. Omit to append." },
    stepTitle: { type: ["string", "null"], maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 5000 },
    duration: { type: ["integer", "null"], minimum: 1 },
    ingredients: arrayOf(ref("RecipeIngredientInput")),
    outputStepNums: arrayOf({ type: "integer", minimum: 1 }),
  }),
  UpdateRecipeStepRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
    stepTitle: { type: ["string", "null"], maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 5000 },
    duration: { type: ["integer", "null"], minimum: 1 },
    outputStepNums: arrayOf({ type: "integer", minimum: 1 }),
  }),
  DeleteRecipeStepRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  CreateRecipeStepIngredientRequest: objectSchema(["clientMutationId", "quantity", "unit", "name"], {
    clientMutationId: shortTextSchema,
    quantity: { type: "number", minimum: 0.001, maximum: 99999 },
    unit: { type: "string", minLength: 1, maxLength: 50 },
    name: { type: "string", minLength: 1, maxLength: 100 },
  }),
  DeleteRecipeStepIngredientRequest: objectSchema(["clientMutationId"], {
    clientMutationId: shortTextSchema,
  }),
  ReorderRecipeStepRequest: objectSchema(["clientMutationId", "stepId", "toStepNum"], {
    clientMutationId: shortTextSchema,
    stepId: idSchema,
    toStepNum: { type: "integer", minimum: 1 },
  }),
  ReplaceRecipeStepOutputUsesRequest: objectSchema(["clientMutationId", "inputStepId", "outputStepNums"], {
    clientMutationId: shortTextSchema,
    inputStepId: idSchema,
    outputStepNums: arrayOf({ type: "integer", minimum: 1 }),
  }),
  DeletedRecipeTombstone: objectSchema(["id", "deletedAt", "updatedAt"], {
    id: idSchema,
    deletedAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  DeletedRecipeStepTombstone: objectSchema(["id"], {
    id: idSchema,
  }),
  DeletedRecipeIngredientTombstone: objectSchema(["id"], {
    id: idSchema,
  }),
  RecipeForkMetadata: objectSchema(["appliedTitle", "sourceChef", "sourceRecipeId", "titleWasSuffixed"], {
    appliedTitle: { type: "string" },
    sourceChef: ref("ChefSummary"),
    sourceRecipeId: idSchema,
    titleWasSuffixed: { type: "boolean" },
  }),
  CreateRecipeData: objectSchema(["created", "recipe", "mutation"], {
    created: { type: "boolean" },
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateRecipeData: objectSchema(["updated", "recipe", "mutation"], {
    updated: { type: "boolean" },
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteRecipeData: objectSchema(["deleted", "recipe", "mutation"], {
    deleted: { type: "boolean" },
    recipe: ref("DeletedRecipeTombstone"),
    mutation: ref("MutationMetadata"),
  }),
  ForkRecipeData: objectSchema(["fork", "recipe", "mutation"], {
    fork: ref("RecipeForkMetadata"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  CreateRecipeStepData: objectSchema(["created", "step", "recipe", "mutation"], {
    created: { type: "boolean" },
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateRecipeStepData: objectSchema(["updated", "step", "recipe", "mutation"], {
    updated: { type: "boolean" },
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteRecipeStepData: objectSchema(["deleted", "step", "recipe", "mutation"], {
    deleted: { type: "boolean" },
    step: ref("DeletedRecipeStepTombstone"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  CreateRecipeStepIngredientData: objectSchema(["created", "ingredient", "step", "recipe", "mutation"], {
    created: { type: "boolean" },
    ingredient: ref("RecipeIngredient"),
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteRecipeStepIngredientData: objectSchema(["deleted", "ingredient", "step", "recipe", "mutation"], {
    deleted: { type: "boolean" },
    ingredient: ref("DeletedRecipeIngredientTombstone"),
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  ReorderRecipeStepData: objectSchema(["reordered", "step", "recipe", "mutation"], {
    reordered: { type: "boolean" },
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  ReplaceRecipeStepOutputUsesData: objectSchema(["replaced", "step", "recipe", "mutation"], {
    replaced: { type: "boolean" },
    step: ref("RecipeStep"),
    recipe: ref("RecipeDetail"),
    mutation: ref("MutationMetadata"),
  }),
  RecipeCoverListEnvelope: successEnvelope(ref("RecipeCoverListData")),
  RecipeCoverMutationEnvelope: successEnvelope(ref("RecipeCoverMutationData")),
  ActiveRecipeCoverMutationEnvelope: successEnvelope(ref("ActiveRecipeCoverMutationData")),
  RecipeSpoonListEnvelope: successEnvelope(ref("RecipeSpoonListData")),
  CreateRecipeSpoonEnvelope: successEnvelope(ref("CreateRecipeSpoonData")),
  UpdateRecipeSpoonEnvelope: successEnvelope(ref("UpdateRecipeSpoonData")),
  DeleteRecipeSpoonEnvelope: successEnvelope(ref("DeleteRecipeSpoonData")),
  CookbookListData: objectSchema(["query", "limit", "cursor", "nextCursor", "hasMore", "cookbooks"], {
    query: nullableStringSchema,
    limit: { type: "integer" },
    cursor: nullableStringSchema,
    nextCursor: nullableStringSchema,
    hasMore: { type: "boolean" },
    cookbooks: arrayOf(ref("CookbookSummary")),
  }),
  CookbookDetailData: objectSchema(["cookbook"], { cookbook: ref("CookbookDetail") }),
  DeletedCookbookTombstone: objectSchema(["id", "title", "deletedAt"], {
    id: idSchema,
    title: { type: "string" },
    deletedAt: dateTimeSchema,
  }),
  CreateCookbookData: objectSchema(["created", "cookbook", "mutation"], {
    created: { type: "boolean" },
    cookbook: ref("CookbookDetail"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateCookbookData: objectSchema(["updated", "cookbook", "mutation"], {
    updated: { type: "boolean" },
    cookbook: ref("CookbookDetail"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteCookbookData: objectSchema(["deleted", "cookbook", "mutation"], {
    deleted: { const: true },
    cookbook: ref("DeletedCookbookTombstone"),
    mutation: ref("MutationMetadata"),
  }),
  AddRecipeToCookbookData: objectSchema(["added", "cookbook", "mutation"], {
    added: { type: "boolean" },
    cookbook: ref("CookbookDetail"),
    mutation: ref("MutationMetadata"),
  }),
  RemoveRecipeFromCookbookData: objectSchema(["removed", "cookbook", "mutation"], {
    removed: { type: "boolean" },
    cookbook: ref("CookbookDetail"),
    mutation: ref("MutationMetadata"),
  }),
  TokenListData: objectSchema(["tokens"], { tokens: arrayOf(ref("CredentialMetadata")) }),
  CreateTokenData: objectSchema(["token", "credential"], {
    token: { type: "string" },
    credential: ref("CredentialMetadata"),
  }),
  RevokeTokenData: objectSchema(["revoked", "credential"], {
    revoked: { type: "boolean" },
    credential: ref("CredentialMetadata"),
  }),
  ShoppingListData: objectSchema(["shoppingList", "nextCursor"], {
    shoppingList: ref("ShoppingList"),
    nextCursor: {
      type: "string",
      description: "Bootstrap cursor for /api/v1/shopping-list/sync. Store and pass back opaquely even when it looks like an ISO timestamp.",
    },
  }),
  ShoppingListSyncData: objectSchema(["items", "nextCursor", "hasMore"], {
    items: arrayOf(ref("ShoppingItem")),
    nextCursor: { type: "string", description: "Opaque v1.* sync cursor to store only after applying the whole page." },
    hasMore: { type: "boolean" },
  }),
  CreateShoppingItemData: objectSchema(["created", "updated", "item", "mutation"], {
    created: { type: "boolean" },
    updated: { type: "boolean" },
    item: ref("ShoppingItem"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateShoppingItemData: objectSchema(["item", "mutation"], {
    item: ref("ShoppingItem"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteShoppingItemData: objectSchema(["removed", "item", "mutation"], {
    removed: { type: "boolean" },
    item: ref("ShoppingItem"),
    mutation: ref("MutationMetadata"),
  }),
  ShoppingRecipeReference: objectSchema(["id", "title"], {
    id: idSchema,
    title: { type: "string" },
  }),
  AddRecipeToShoppingListData: objectSchema(["created", "updated", "recipe", "items", "mutation"], {
    created: { type: "integer", minimum: 0 },
    updated: { type: "integer", minimum: 0 },
    recipe: ref("ShoppingRecipeReference"),
    items: arrayOf(ref("ShoppingItem")),
    mutation: ref("MutationMetadata"),
  }),
  ClearShoppingItemsData: objectSchema(["cleared", "items", "mutation"], {
    cleared: { type: "integer", minimum: 0 },
    items: arrayOf(ref("ShoppingItem")),
    mutation: ref("MutationMetadata"),
  }),
  DiscoveryEnvelope: successEnvelope(ref("DiscoveryData")),
  HealthEnvelope: successEnvelope(ref("HealthData")),
  RecipeListEnvelope: successEnvelope(ref("RecipeListData")),
  RecipeDetailEnvelope: successEnvelope(ref("RecipeDetailData")),
  CreateRecipeEnvelope: successEnvelope(ref("CreateRecipeData")),
  UpdateRecipeEnvelope: successEnvelope(ref("UpdateRecipeData")),
  DeleteRecipeEnvelope: successEnvelope(ref("DeleteRecipeData")),
  ForkRecipeEnvelope: successEnvelope(ref("ForkRecipeData")),
  RecipeImportEnvelope: successEnvelope(ref("RecipeImportMutationData")),
  CreateRecipeStepEnvelope: successEnvelope(ref("CreateRecipeStepData")),
  UpdateRecipeStepEnvelope: successEnvelope(ref("UpdateRecipeStepData")),
  DeleteRecipeStepEnvelope: successEnvelope(ref("DeleteRecipeStepData")),
  CreateRecipeStepIngredientEnvelope: successEnvelope(ref("CreateRecipeStepIngredientData")),
  DeleteRecipeStepIngredientEnvelope: successEnvelope(ref("DeleteRecipeStepIngredientData")),
  ReorderRecipeStepEnvelope: successEnvelope(ref("ReorderRecipeStepData")),
  ReplaceRecipeStepOutputUsesEnvelope: successEnvelope(ref("ReplaceRecipeStepOutputUsesData")),
  CookbookListEnvelope: successEnvelope(ref("CookbookListData")),
  CookbookDetailEnvelope: successEnvelope(ref("CookbookDetailData")),
  CreateCookbookEnvelope: successEnvelope(ref("CreateCookbookData")),
  UpdateCookbookEnvelope: successEnvelope(ref("UpdateCookbookData")),
  DeleteCookbookEnvelope: successEnvelope(ref("DeleteCookbookData")),
  AddRecipeToCookbookEnvelope: successEnvelope(ref("AddRecipeToCookbookData")),
  AddRecipeToCookbookExistingEnvelope: successEnvelope(ref("AddRecipeToCookbookData")),
  RemoveRecipeFromCookbookEnvelope: successEnvelope(ref("RemoveRecipeFromCookbookData")),
  UserProfileEnvelope: successEnvelope(ref("UserProfileData")),
  ProfileGraphEnvelope: successEnvelope(ref("ProfileGraphData")),
  SearchEnvelope: successEnvelope(ref("SearchData")),
  TokenListEnvelope: successEnvelope(ref("TokenListData")),
  CreateTokenEnvelope: successEnvelope(ref("CreateTokenData")),
  RevokeTokenEnvelope: successEnvelope(ref("RevokeTokenData")),
  ShoppingListEnvelope: successEnvelope(ref("ShoppingListData")),
  ShoppingListSyncEnvelope: successEnvelope(ref("ShoppingListSyncData")),
  CreateShoppingItemEnvelope: successEnvelope(ref("CreateShoppingItemData")),
  UpdateShoppingItemEnvelope: successEnvelope(ref("UpdateShoppingItemData")),
  DeleteShoppingItemEnvelope: successEnvelope(ref("DeleteShoppingItemData")),
  AddRecipeToShoppingListEnvelope: successEnvelope(ref("AddRecipeToShoppingListData")),
  ClearShoppingItemsEnvelope: successEnvelope(ref("ClearShoppingItemsData")),
} satisfies Record<string, JsonSchema>;

const pathParameters = {
  id: { name: "id", in: "path", required: true, description: "Spoonjoy resource id from a previous list response.", schema: idSchema },
  itemId: { name: "itemId", in: "path", required: true, description: "Shopping-list item id from GET /api/v1/shopping-list or /sync.", schema: idSchema },
  credentialId: { name: "credentialId", in: "path", required: true, description: "Bearer credential id from GET /api/v1/tokens.", schema: idSchema },
  stepId: { name: "stepId", in: "path", required: true, description: "Recipe step id from recipe detail.", schema: idSchema },
  ingredientId: { name: "ingredientId", in: "path", required: true, description: "Recipe step ingredient id from recipe detail.", schema: idSchema },
  coverId: { name: "coverId", in: "path", required: true, description: "Recipe cover id from cover history.", schema: idSchema },
  spoonId: { name: "spoonId", in: "path", required: true, description: "Spoon/cook-log id from recipe or profile responses.", schema: idSchema },
  recipeId: { name: "recipeId", in: "path", required: true, description: "Recipe id being added to or removed from a cookbook.", schema: idSchema },
  deviceId: { name: "deviceId", in: "path", required: true, description: "Native APNs device registration id.", schema: idSchema },
  connectionId: { name: "connectionId", in: "path", required: true, description: "OAuth app connection id from GET /api/v1/me/connections.", schema: idSchema },
  identifier: { name: "identifier", in: "path", required: true, description: "Chef username or id.", schema: idSchema },
  requestIdHeader: {
    name: "X-Request-Id",
    in: "header",
    required: false,
    description: "Optional client-generated request id. Spoonjoy echoes it in X-Request-Id and the REST envelope for logs, retries, and support.",
    schema: { type: "string", minLength: 1, maxLength: 160 },
  },
  clientMutationIdHeader: {
    name: "X-Client-Mutation-Id",
    in: "header",
    required: true,
    description: "Chef-wide idempotency key for this delete. Use the same value when retrying the exact same request after a timeout.",
    schema: { type: "string", minLength: 1, maxLength: 160 },
  },
  clientMutationIdQuery: {
    name: "clientMutationId",
    in: "query",
    required: false,
    description: "Chef-wide idempotency key fallback for clients that cannot send a JSON body with DELETE. Prefer the JSON body or X-Client-Mutation-Id header.",
    schema: { type: "string", minLength: 1, maxLength: 160 },
  },
};

const optionalClientMutationIdHeader = {
  ...pathParameters.clientMutationIdHeader,
  required: false,
  description: "Chef-wide idempotency key fallback for clients that cannot send a JSON body with DELETE. Prefer the JSON body when available; otherwise use this header or clientMutationId query.",
};
const stepDeleteClientMutationIdHeader = optionalClientMutationIdHeader;

const queryParameters = {
  query: { name: "query", in: "query", required: false, description: "Search text. When both query and q are sent, query wins.", schema: { type: "string" } },
  q: { name: "q", in: "query", required: false, description: "Search-text alias for clients that conventionally use q. Ignored when query is also present.", schema: { type: "string" } },
  scope: { name: "scope", in: "query", required: false, description: "Search scope. The legacy shopping alias normalizes to shopping-list. Explicit shopping-list search requires shopping_list:read or kitchen:read; scope=all includes owner shopping-list results only for callers with one of those scopes.", schema: { type: "string", enum: ["all", "recipes", "cookbooks", "chefs", "shopping-list", "shopping"], default: "all" } },
  page: { name: "page", in: "query", required: false, description: "One-based page number for chef graph lists.", schema: { type: "integer", minimum: 1, default: 1 } },
  cursor: { name: "cursor", in: "query", required: false, description: "Opaque pagination cursor returned as nextCursor. Catalog cursors are v1.* values; shopping-list sync also accepts an ISO timestamp only as bootstrap compatibility.", schema: { type: "string" }, examples: { catalog: { value: "v1.cursor_from_nextCursor" }, sync: { value: "v1.cursor_or_iso_bootstrap" } } },
  limit: { name: "limit", in: "query", required: false, description: "Page size from 1 to 50. Defaults to 20.", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
  graphLimit: { name: "limit", in: "query", required: false, description: "Graph page size from 1 to 50. Defaults to 50.", schema: { type: "integer", minimum: 1, maximum: 50, default: 50 } },
};

const discoveryErrors: ApiV1ErrorCode[] = ["validation_error", "invalid_token", "method_not_allowed", "rate_limited", "internal_error"];
const optionalReadErrors: ApiV1ErrorCode[] = ["validation_error", "invalid_cursor", "invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"];
const bearerReadErrors: ApiV1ErrorCode[] = ["validation_error", "invalid_cursor", "authentication_required", "invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"];
const bearerMutationErrors: ApiV1ErrorCode[] = ["invalid_json", "validation_error", "authentication_required", "invalid_token", "insufficient_scope", "not_found", "idempotency_conflict", "idempotency_in_progress", "method_not_allowed", "rate_limited", "internal_error"];
const nativeContractSuccess: Record<number, string> = { 200: "NativeContractEnvelope" };
const nativeContractCreated: Record<number, string> = { 201: "NativeContractEnvelope" };

const operationMeta: Record<ResourcePath, Partial<Record<HttpMethod, OperationConfig>>> = {
  "/api/v1": {
    GET: { operationId: "getApiV1Root", tags: ["Discovery"], summary: "Discover the Spoonjoy API", auth: "optional", scopes: [], success: { 200: "DiscoveryEnvelope" }, errors: discoveryErrors },
  },
  "/api/v1/health": {
    GET: { operationId: "getApiV1Health", tags: ["Discovery"], summary: "Check API health", auth: "optional", scopes: [], success: { 200: "HealthEnvelope" }, errors: discoveryErrors },
  },
  "/api/v1/openapi.json": {
    GET: { operationId: "getApiV1OpenApi", tags: ["Discovery"], summary: "Fetch the OpenAPI document", auth: "optional", scopes: [], success: { 200: "OpenApiDocument" }, errors: discoveryErrors },
  },
  "/api/v1/openapi.sdk.json": {
    GET: { operationId: "getApiV1SdkOpenApi", tags: ["Discovery"], summary: "Fetch the SDK OpenAPI profile", auth: "optional", scopes: [], success: { 200: "SdkOpenApiDocument" }, errors: discoveryErrors },
  },
  "/api/v1/openapi.connector.json": {
    GET: { operationId: "getApiV1ConnectorOpenApi", tags: ["Discovery"], summary: "Fetch the no-code connector OpenAPI profile", auth: "optional", scopes: [], success: { 200: "ConnectorOpenApiDocument" }, errors: discoveryErrors },
  },
  "/api/v1/recipes": {
    GET: { operationId: "getApiV1Recipes", tags: ["Recipes"], summary: "Search public recipes", auth: "optional", scopes: ["recipes:read"], success: { 200: "RecipeListEnvelope" }, errors: optionalReadErrors, parameters: [queryParameters.query, queryParameters.q, queryParameters.cursor, queryParameters.limit] },
    POST: { operationId: "postApiV1Recipes", tags: ["Recipes"], summary: "Create a recipe", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "CreateRecipeEnvelope" }, errors: bearerMutationErrors, requestBody: "CreateRecipeRequest" },
  },
  "/api/v1/recipes/{id}": {
    GET: { operationId: "getApiV1Recipe", tags: ["Recipes"], summary: "Read one public recipe", auth: "optional", scopes: ["recipes:read"], success: { 200: "RecipeDetailEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.id] },
    PATCH: { operationId: "patchApiV1Recipe", tags: ["Recipes"], summary: "Update a recipe", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "UpdateRecipeEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "UpdateRecipeRequest" },
    DELETE: { operationId: "deleteApiV1Recipe", tags: ["Recipes"], summary: "Delete a recipe", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "DeleteRecipeEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.clientMutationIdHeader], requestBody: "DeleteRecipeRequest" },
  },
  "/api/v1/recipes/{id}/fork": {
    POST: { operationId: "postApiV1RecipeFork", tags: ["Recipes"], summary: "Fork a recipe", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "ForkRecipeEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "ForkRecipeRequest" },
  },
  "/api/v1/recipes/{id}/steps": {
    POST: { operationId: "postApiV1RecipeSteps", tags: ["Recipe Steps"], summary: "Create a recipe step", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "CreateRecipeStepEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "CreateRecipeStepRequest" },
  },
  "/api/v1/recipes/{id}/steps/{stepId}": {
    PATCH: { operationId: "patchApiV1RecipeStep", tags: ["Recipe Steps"], summary: "Update a recipe step", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "UpdateRecipeStepEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.stepId], requestBody: "UpdateRecipeStepRequest" },
    DELETE: { operationId: "deleteApiV1RecipeStep", tags: ["Recipe Steps"], summary: "Delete a recipe step", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "DeleteRecipeStepEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.stepId, stepDeleteClientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "DeleteRecipeStepRequest", requestBodyRequired: false },
  },
  "/api/v1/recipes/{id}/steps/reorder": {
    POST: { operationId: "postApiV1RecipeStepsReorder", tags: ["Recipe Steps"], summary: "Reorder recipe steps", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "ReorderRecipeStepEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "ReorderRecipeStepRequest" },
  },
  "/api/v1/recipes/{id}/steps/{stepId}/ingredients": {
    POST: { operationId: "postApiV1RecipeStepIngredients", tags: ["Recipe Steps"], summary: "Add a step ingredient", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "CreateRecipeStepIngredientEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.stepId], requestBody: "CreateRecipeStepIngredientRequest" },
  },
  "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}": {
    DELETE: { operationId: "deleteApiV1RecipeStepIngredient", tags: ["Recipe Steps"], summary: "Delete a step ingredient", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "DeleteRecipeStepIngredientEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.stepId, pathParameters.ingredientId, stepDeleteClientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "DeleteRecipeStepIngredientRequest", requestBodyRequired: false },
  },
  "/api/v1/recipes/{id}/step-output-uses": {
    PUT: { operationId: "putApiV1RecipeStepOutputUses", tags: ["Recipe Steps"], summary: "Replace step-output dependency uses", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "ReplaceRecipeStepOutputUsesEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "ReplaceRecipeStepOutputUsesRequest" },
  },
  "/api/v1/recipes/{id}/image": {
    POST: { operationId: "postApiV1RecipeImage", tags: ["Recipe Covers"], summary: "Upload a recipe image as a cover candidate", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "RecipeCoverMutationEnvelope", 202: "RecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "RecipeImageUploadRequest" },
  },
  "/api/v1/recipes/{id}/covers": {
    GET: { operationId: "getApiV1RecipeCovers", tags: ["Recipe Covers"], summary: "List owner cover history and spoon photo sources", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "RecipeCoverListEnvelope" }, errors: bearerReadErrors, parameters: [pathParameters.id] },
    POST: { operationId: "postApiV1RecipeCovers", tags: ["Recipe Covers"], summary: "Create a recipe cover from an uploaded Spoonjoy image URL", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "RecipeCoverMutationEnvelope", 202: "RecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "CreateRecipeCoverRequest" },
  },
  "/api/v1/recipes/{id}/covers/{coverId}": {
    PATCH: { operationId: "patchApiV1RecipeCover", tags: ["Recipe Covers"], summary: "Set a cover variant as active", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "ActiveRecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.coverId], requestBody: "ActivateRecipeCoverRequest" },
    DELETE: { operationId: "deleteApiV1RecipeCover", tags: ["Recipe Covers"], summary: "Archive a recipe cover", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "ActiveRecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.coverId, pathParameters.clientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "ArchiveRecipeCoverRequest", requestBodyRequired: false },
  },
  "/api/v1/recipes/{id}/covers/regenerate": {
    POST: { operationId: "postApiV1RecipeCoversRegenerate", tags: ["Recipe Covers"], summary: "Regenerate a cover's editorial variant", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "RecipeCoverMutationEnvelope", 202: "RecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "RegenerateRecipeCoverRequest" },
  },
  "/api/v1/recipes/{id}/covers/from-spoon/{spoonId}": {
    POST: { operationId: "postApiV1RecipeCoverFromSpoon", tags: ["Recipe Covers"], summary: "Create a recipe cover from an existing spoon photo", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "RecipeCoverMutationEnvelope", 202: "RecipeCoverMutationEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.spoonId], requestBody: "RecipeCoverFromSpoonRequest" },
  },
  "/api/v1/recipes/{id}/spoons": {
    GET: { operationId: "getApiV1RecipeSpoons", tags: ["Spoons"], summary: "List recipe spoons and cook logs", auth: "optional", scopes: ["recipes:read"], success: { 200: "RecipeSpoonListEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.id, queryParameters.cursor, queryParameters.limit] },
    POST: { operationId: "postApiV1RecipeSpoons", tags: ["Spoons"], summary: "Create a spoon or cook log", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "CreateRecipeSpoonEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "CreateRecipeSpoonRequest" },
  },
  "/api/v1/recipes/{id}/spoons/{spoonId}": {
    PATCH: { operationId: "patchApiV1RecipeSpoon", tags: ["Spoons"], summary: "Update a spoon or cook log", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "UpdateRecipeSpoonEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.spoonId], requestBody: "UpdateRecipeSpoonRequest" },
    DELETE: { operationId: "deleteApiV1RecipeSpoon", tags: ["Spoons"], summary: "Delete a spoon or cook log", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "DeleteRecipeSpoonEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.spoonId, pathParameters.clientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "DeleteRecipeSpoonRequest", requestBodyRequired: false },
  },
  "/api/v1/cookbooks": {
    GET: { operationId: "getApiV1Cookbooks", tags: ["Cookbooks"], summary: "Search public cookbooks", auth: "optional", scopes: ["cookbooks:read"], success: { 200: "CookbookListEnvelope" }, errors: optionalReadErrors, parameters: [queryParameters.query, queryParameters.q, queryParameters.cursor, queryParameters.limit] },
    POST: { operationId: "postApiV1Cookbooks", tags: ["Cookbooks"], summary: "Create a cookbook", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "CreateCookbookEnvelope" }, errors: bearerMutationErrors, requestBody: "CreateCookbookRequest" },
  },
  "/api/v1/cookbooks/{id}": {
    GET: { operationId: "getApiV1Cookbook", tags: ["Cookbooks"], summary: "Read one public cookbook", auth: "optional", scopes: ["cookbooks:read"], success: { 200: "CookbookDetailEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.id] },
    PATCH: { operationId: "patchApiV1Cookbook", tags: ["Cookbooks"], summary: "Update a cookbook", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "UpdateCookbookEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id], requestBody: "UpdateCookbookRequest" },
    DELETE: { operationId: "deleteApiV1Cookbook", tags: ["Cookbooks"], summary: "Delete a cookbook", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "DeleteCookbookEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, optionalClientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "DeleteCookbookRequest", requestBodyRequired: false },
  },
  "/api/v1/cookbooks/{id}/recipes/{recipeId}": {
    POST: { operationId: "postApiV1CookbookRecipe", tags: ["Cookbooks"], summary: "Add a recipe to a cookbook", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "AddRecipeToCookbookExistingEnvelope", 201: "AddRecipeToCookbookEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.recipeId], requestBody: "CookbookRecipeMutationRequest" },
    DELETE: { operationId: "deleteApiV1CookbookRecipe", tags: ["Cookbooks"], summary: "Remove a recipe from a cookbook", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "RemoveRecipeFromCookbookEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.id, pathParameters.recipeId, optionalClientMutationIdHeader, pathParameters.clientMutationIdQuery], requestBody: "CookbookRecipeMutationRequest", requestBodyRequired: false },
  },
  "/api/v1/shopping-list": {
    GET: { operationId: "getApiV1ShoppingList", tags: ["Shopping List"], summary: "Read the authenticated shopping list", auth: "bearer", scopes: ["shopping_list:read"], success: { 200: "ShoppingListEnvelope" }, errors: bearerReadErrors },
  },
  "/api/v1/shopping-list/sync": {
    GET: { operationId: "getApiV1ShoppingListSync", tags: ["Shopping List"], summary: "Sync shopping-list changes", auth: "bearer", scopes: ["shopping_list:read"], success: { 200: "ShoppingListSyncEnvelope" }, errors: bearerReadErrors, parameters: [queryParameters.cursor, queryParameters.limit] },
  },
  "/api/v1/shopping-list/items": {
    POST: { operationId: "postApiV1ShoppingListItems", tags: ["Shopping List"], summary: "Add or restore a shopping-list item", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "CreateShoppingItemEnvelope", 201: "CreateShoppingItemEnvelope" }, errors: bearerMutationErrors, requestBody: "CreateShoppingItemRequest" },
  },
  "/api/v1/shopping-list/items/{itemId}": {
    PATCH: { operationId: "patchApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Set a shopping-list item checked state", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "UpdateShoppingItemEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.itemId], requestBody: "CheckShoppingItemRequest" },
    DELETE: { operationId: "deleteApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Remove a shopping-list item", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "DeleteShoppingItemEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.itemId, pathParameters.clientMutationIdHeader] },
  },
  "/api/v1/shopping-list/add-from-recipe": {
    POST: { operationId: "postApiV1ShoppingListAddFromRecipe", tags: ["Shopping List"], summary: "Add recipe ingredients to the shopping list", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "AddRecipeToShoppingListEnvelope" }, errors: bearerMutationErrors, requestBody: "AddRecipeToShoppingListRequest" },
  },
  "/api/v1/shopping-list/clear-completed": {
    POST: { operationId: "postApiV1ShoppingListClearCompleted", tags: ["Shopping List"], summary: "Clear completed shopping-list items", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "ClearShoppingItemsEnvelope" }, errors: bearerMutationErrors, requestBody: "ClearShoppingItemsRequest" },
  },
  "/api/v1/shopping-list/clear-all": {
    POST: { operationId: "postApiV1ShoppingListClearAll", tags: ["Shopping List"], summary: "Clear all shopping-list items", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "ClearShoppingItemsEnvelope" }, errors: bearerMutationErrors, requestBody: "ClearShoppingItemsRequest" },
  },
  "/api/v1/me": {
    GET: { operationId: "getApiV1Me", tags: ["Account"], summary: "Read the current chef account", auth: "bearer", scopes: ["kitchen:read"], success: { 200: "NativeAccountSnapshotEnvelope" }, errors: bearerReadErrors },
    PATCH: { operationId: "patchApiV1Me", tags: ["Account"], summary: "Update current chef profile fields", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeAccountSnapshotEnvelope" }, errors: bearerMutationErrors, requestBody: "NativeProfileRequest" },
  },
  "/api/v1/me/photo": {
    POST: { operationId: "postApiV1MePhoto", tags: ["Account"], summary: "Upload current chef profile photo", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeProfilePhotoEnvelope" }, errors: bearerMutationErrors, requestBody: "ProfilePhotoUploadRequest" },
    DELETE: { operationId: "deleteApiV1MePhoto", tags: ["Account"], summary: "Remove current chef profile photo", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeProfilePhotoRemoveEnvelope" }, errors: bearerMutationErrors },
  },
  "/api/v1/me/kitchen": {
    GET: { operationId: "getApiV1MeKitchen", tags: ["Account"], summary: "Bootstrap current chef kitchen data", auth: "bearer", scopes: ["kitchen:read"], success: { 200: "NativeAccountSnapshotEnvelope" }, errors: bearerReadErrors },
  },
  "/api/v1/me/notification-preferences": {
    GET: { operationId: "getApiV1MeNotificationPreferences", tags: ["Account"], summary: "Read notification preferences", auth: "bearer", scopes: ["kitchen:read"], success: { 200: "NativeNotificationPreferencesEnvelope" }, errors: bearerReadErrors },
    PATCH: { operationId: "patchApiV1MeNotificationPreferences", tags: ["Account"], summary: "Update notification preferences", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeNotificationPreferencesEnvelope" }, errors: bearerMutationErrors, requestBody: "NativeNotificationPreferencesRequest" },
  },
  "/api/v1/me/apns-devices": {
    POST: { operationId: "postApiV1MeApnsDevices", tags: ["Account"], summary: "Register a native APNs device", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeApnsDeviceEnvelope", 201: "NativeApnsDeviceEnvelope" }, errors: bearerMutationErrors, requestBody: "NativeApnsDeviceRequest" },
  },
  "/api/v1/me/apns-devices/{deviceId}": {
    DELETE: { operationId: "deleteApiV1MeApnsDevice", tags: ["Account"], summary: "Revoke native APNs registrations for a device", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeApnsDeviceRevokeEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.deviceId] },
  },
  "/api/v1/me/connections": {
    GET: { operationId: "getApiV1MeConnections", tags: ["Account"], summary: "List connected OAuth apps", auth: "bearer", scopes: ["kitchen:read"], success: { 200: "NativeOAuthConnectionsEnvelope" }, errors: bearerReadErrors },
  },
  "/api/v1/me/connections/{connectionId}": {
    DELETE: { operationId: "deleteApiV1MeConnection", tags: ["Account"], summary: "Disconnect an OAuth app connection", auth: "bearer", scopes: ["kitchen:write"], success: { 200: "NativeOAuthConnectionDisconnectEnvelope" }, errors: bearerMutationErrors, parameters: [pathParameters.connectionId] },
  },
  "/api/v1/tokens": {
    GET: { operationId: "getApiV1Tokens", tags: ["Tokens"], summary: "List bearer credentials", auth: "bearer", scopes: ["tokens:read"], success: { 200: "TokenListEnvelope" }, errors: ["validation_error", "authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"] },
    POST: { operationId: "postApiV1Tokens", tags: ["Tokens"], summary: "Create a bearer credential", auth: "bearer", scopes: ["tokens:write"], success: { 201: "CreateTokenEnvelope" }, errors: ["invalid_json", "validation_error", "invalid_scope", "authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"], requestBody: "CreateTokenRequest" },
  },
  "/api/v1/tokens/{credentialId}": {
    DELETE: { operationId: "deleteApiV1Token", tags: ["Tokens"], summary: "Revoke a bearer credential", auth: "bearer", scopes: ["tokens:write"], success: { 200: "RevokeTokenEnvelope" }, errors: ["validation_error", "authentication_required", "invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.credentialId] },
  },
  "/api/v1/me/sync": {
    GET: { operationId: "getApiV1MeSync", tags: ["Sync"], summary: "Sync private native cache data", auth: "bearer", scopes: ["kitchen:read"], success: { 200: "NativeSyncEnvelope" }, errors: bearerReadErrors, parameters: [queryParameters.cursor, queryParameters.limit] },
  },
  "/api/v1/users/{identifier}": {
    GET: { operationId: "getApiV1User", tags: ["Profiles"], summary: "Read a chef profile", auth: "optional", scopes: ["public:read"], success: { 200: "UserProfileEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.identifier] },
  },
  "/api/v1/users/{identifier}/fellow-chefs": {
    GET: { operationId: "getApiV1UserFellowChefs", tags: ["Profiles"], summary: "List fellow chefs for a profile", auth: "optional", scopes: ["public:read"], success: { 200: "ProfileGraphEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.identifier, queryParameters.page, queryParameters.graphLimit] },
  },
  "/api/v1/users/{identifier}/kitchen-visitors": {
    GET: { operationId: "getApiV1UserKitchenVisitors", tags: ["Profiles"], summary: "List kitchen visitors for a profile", auth: "optional", scopes: ["public:read"], success: { 200: "ProfileGraphEnvelope" }, errors: optionalReadErrors, parameters: [pathParameters.identifier, queryParameters.page, queryParameters.graphLimit] },
  },
  "/api/v1/search": {
    GET: { operationId: "getApiV1Search", tags: ["Search"], summary: "Search recipes, cookbooks, chefs, and private shopping-list items", auth: "optional", scopes: [], success: { 200: "SearchEnvelope" }, errors: [...optionalReadErrors, "authentication_required"], errorScopes: ["shopping_list:read"], parameters: [queryParameters.query, queryParameters.q, queryParameters.scope, queryParameters.limit] },
  },
  "/api/v1/recipes/import": {
    POST: { operationId: "postApiV1RecipesImport", tags: ["Recipes"], summary: "Import a recipe from a URL, text, JSON-LD capture, or video URL", auth: "bearer", scopes: ["kitchen:write"], success: { 201: "RecipeImportEnvelope", 202: "RecipeImportEnvelope" }, errors: bearerMutationErrors, requestBody: "RecipeImportRequest" },
  },
};

const exampleTimestamp = "2026-06-01T00:00:00.000Z";
const exampleChef = { id: "chef_1", username: "ari" };
const exampleSourceChef = { id: "chef_source", username: "jules" };
const examplePrincipal = { ...exampleChef, source: "bearer" };
const exampleRecipeIngredient = { id: "ingredient_1", name: "pasta", quantity: 1, unit: "lb" };
const exampleGarlicIngredient = { id: "ingredient_2", name: "garlic", quantity: 2, unit: "cloves" };
const exampleRecipeStep = {
  id: "step_1",
  stepNum: 1,
  stepTitle: null,
  description: "Boil pasta.",
  duration: null,
  ingredients: [exampleRecipeIngredient],
  usingSteps: [],
};
const exampleRecipeStepOutputUse = {
  id: "step_use_1",
  inputStepNum: 2,
  outputStepNum: 1,
  outputOfStep: { stepNum: 1, stepTitle: null },
};
const exampleDependentRecipeStep = {
  id: "step_2",
  stepNum: 2,
  stepTitle: "Sauce",
  description: "Toss pasta with sauce.",
  duration: 3,
  ingredients: [],
  usingSteps: [exampleRecipeStepOutputUse],
};
const exampleDependentRecipeStepWithGarlic = {
  ...exampleDependentRecipeStep,
  ingredients: [exampleGarlicIngredient],
};
const exampleCookbookLink = {
  id: "cookbook_1",
  title: "Weeknights",
  href: "/cookbooks/cookbook_1",
  canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_1",
};
const exampleRecipeDetailSpoon = {
  id: "spoon_1",
  chefId: "chef_2",
  recipeId: "recipe_1",
  cookedAt: exampleTimestamp,
  photoUrl: "/photos/spoons/chef_2/recipe_1/cooked.jpg",
  note: "Loved this with extra lemon.",
  nextTime: null,
  deletedAt: null,
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
  chef: { id: "chef_2", username: "jules", photoUrl: null },
};
const exampleRecipeSummary = {
  id: "recipe_1",
  title: "Pasta",
  description: "Weeknight pasta",
  servings: "4",
  chef: exampleChef,
  coverImageUrl: "https://spoonjoy.app/photos/recipes/recipe_1/cover.jpg",
  coverProvenanceLabel: "Chef photo",
  coverSourceType: "chef-upload",
  coverVariant: "image",
  href: "/recipes/recipe_1",
  canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
  attribution: {
    creditText: "Pasta by ari on Spoonjoy",
    canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
    sourceUrl: "https://example.com/original-pasta",
    sourceHost: "example.com",
    sourceRecipe: null,
  },
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleRecipeDetail = {
  ...exampleRecipeSummary,
  steps: [exampleRecipeStep, exampleDependentRecipeStep],
  cookbooks: [exampleCookbookLink],
  recentSpoons: [exampleRecipeDetailSpoon],
};
const exampleRecipeDetailAfterStepDelete = {
  ...exampleRecipeDetail,
  steps: [exampleRecipeStep],
};
const exampleRecipeDetailWithGarlic = {
  ...exampleRecipeDetail,
  steps: [exampleRecipeStep, exampleDependentRecipeStepWithGarlic],
};
const exampleCreatedRecipeDetail = {
  ...exampleRecipeDetail,
  attribution: {
    ...exampleRecipeDetail.attribution,
    sourceUrl: null,
    sourceHost: null,
    sourceRecipe: null,
  },
};
const exampleForkedRecipeDetail = {
  ...exampleRecipeDetail,
  id: "recipe_fork_1",
  title: "Pasta (variation 2)",
  href: "/recipes/recipe_fork_1",
  canonicalUrl: "https://spoonjoy.app/recipes/recipe_fork_1",
  attribution: {
    creditText: "Pasta (variation 2) by ari on Spoonjoy",
    canonicalUrl: "https://spoonjoy.app/recipes/recipe_fork_1",
    sourceUrl: null,
    sourceHost: null,
    sourceRecipe: {
      id: "recipe_source_1",
      title: "Pasta",
      chef: exampleSourceChef,
      href: "/recipes/recipe_source_1",
      canonicalUrl: "https://spoonjoy.app/recipes/recipe_source_1",
      deleted: false,
    },
  },
};
const exampleDeletedRecipe = {
  id: "recipe_1",
  deletedAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleRecipeFork = {
  appliedTitle: "Pasta (variation 2)",
  sourceChef: exampleSourceChef,
  sourceRecipeId: "recipe_source_1",
  titleWasSuffixed: true,
};
const exampleCookbookSummary = {
  id: "cookbook_1",
  title: "Weeknights",
  chef: exampleChef,
  recipeCount: 1,
  coverImageUrls: ["https://spoonjoy.app/photos/recipes/recipe_1/cover.jpg"],
  href: "/cookbooks/cookbook_1",
  canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_1",
  attribution: {
    creditText: "Weeknights by ari on Spoonjoy",
    canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_1",
  },
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleCookbookDetail = { ...exampleCookbookSummary, recipes: [exampleRecipeSummary] };
const exampleCreatedCookbookDetail = {
  ...exampleCookbookDetail,
  id: "cookbook_created_1",
  title: "Packed Lunches",
  href: "/cookbooks/cookbook_created_1",
  canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_created_1",
  attribution: {
    creditText: "Packed Lunches by ari on Spoonjoy",
    canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_created_1",
  },
  recipes: [],
  recipeCount: 0,
  coverImageUrls: [],
};
const exampleDeletedCookbook = {
  id: "cookbook_1",
  title: "Weeknights",
  deletedAt: exampleTimestamp,
};
const exampleProfileSummary = {
  id: "chef_1",
  username: "ari",
  photoUrl: "/photos/profiles/chef_1/avatar.gif",
  joinedLabel: "Joined Jun 2026",
  href: "/users/ari",
  canonicalUrl: "https://spoonjoy.app/users/ari",
};
const exampleProfileRecipe = {
  id: "recipe_1",
  title: "Pasta",
  description: "Weeknight pasta",
  servings: "4",
  coverImageUrl: "/photos/recipes/recipe_1/cover.jpg",
  coverProvenanceLabel: "Chef photo",
  href: "/recipes/recipe_1",
  canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
};
const exampleProfileCookbook = {
  id: "cookbook_1",
  title: "Weeknights",
  recipeCount: 1,
  recipes: [{
    id: "recipe_1",
    title: "Pasta",
    coverImageUrl: "/photos/recipes/recipe_1/cover.jpg",
    coverProvenanceLabel: "Chef photo",
    href: "/recipes/recipe_1",
    canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
  }],
  href: "/cookbooks/cookbook_1",
  canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_1",
};
const exampleRecentSpoon = {
  id: "spoon_1",
  cookedAt: exampleTimestamp,
  photoUrl: null,
  note: "Loved this with extra lemon.",
  nextTime: null,
  chef: { id: "chef_1", username: "ari", photoUrl: "/photos/profiles/chef_1/avatar.gif" },
  recipe: { id: "recipe_2", title: "Lemony Beans", chefId: "chef_2" },
  coverImageUrl: null,
  coverProvenanceLabel: null,
};
const exampleProfileGraphRow = {
  chefId: "chef_2",
  username: "jules",
  photoUrl: null,
  href: "/users/jules",
  canonicalUrl: "https://spoonjoy.app/users/jules",
  interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
  latestInteractionAt: exampleTimestamp,
};
const exampleSearchResult = {
  type: "recipe",
  id: "recipe_1",
  ownerId: "chef_1",
  ownerUsername: "ari",
  owner: { id: "chef_1", username: "ari" },
  title: "Pasta",
  subtitle: "Recipe by ari",
  snippet: "Weeknight pasta",
  href: "/recipes/recipe_1",
  canonicalUrl: "https://spoonjoy.app/recipes/recipe_1",
  imageUrl: "/photos/recipes/recipe_1/cover.jpg",
  score: -1.2,
  metadata: {
    servings: "4",
    chefUsername: "ari",
    ingredientNames: ["tomato"],
    stepCount: 2,
    cookbookTitles: ["Weeknights"],
    coverProvenanceLabel: "Chef photo",
    coverSourceType: "chef-upload",
    coverVariant: "image",
  },
};
const exampleCredential = {
  id: "cred_1",
  name: "Tiny client",
  tokenPrefix: "sj_abc123456",
  scopes: ["recipes:read", "shopping_list:read", "shopping_list:write"],
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
};
const exampleNotificationPreferences = {
  notifySpoonOnMyRecipe: true,
  notifyForkOfMyRecipe: true,
  notifyCookbookSaveOfMine: true,
  notifyFellowChefOriginCook: true,
};
const exampleOAuthConnection = {
  id: "oauth_eyJjbGllbnRJZCI6ImNtX2NsaWVudF9pZCIsInJlc291cmNlIjoiaHR0cHM6Ly9zcG9vbmpveS5hcHAvbWNwIn0",
  clientId: "cm_client_id",
  clientName: "Grocery helper",
  resource: "https://spoonjoy.app/mcp",
  scopes: ["recipes:read", "shopping_list:read"],
  createdAt: exampleTimestamp,
  refreshTokenCount: 1,
  accessTokenCount: 1,
};
const exampleNativeAccount = {
  id: "chef_1",
  email: "ari@example.com",
  username: "ari",
  hasPassword: true,
  photoUrl: "/photos/profiles/chef_1/avatar.gif",
  oauthAccounts: [{ provider: "github", providerUsername: "ari" }],
  passkeys: [{ id: "pk_1", name: "MacBook Touch ID", transports: "internal", createdAt: exampleTimestamp }],
  handoffs: {
    accountSettings: { method: "GET", url: "/account/settings", onlineOnly: true },
    password: { method: "GET", url: "/account/settings", onlineOnly: true, actions: ["changePassword", "removePassword"] },
    passkeys: {
      method: "GET",
      url: "/account/settings",
      onlineOnly: true,
      registrationOptionsUrl: "/auth/webauthn/register/options",
      registrationVerifyUrl: "/auth/webauthn/register/verify",
      actions: ["addPasskey", "renamePasskey", "removePasskey"],
    },
    providerLinks: {
      google: { method: "GET", url: "/auth/google?linking=true", onlineOnly: true },
      github: { method: "GET", url: "/auth/github?linking=true", onlineOnly: true },
      apple: { method: "GET", url: "/auth/apple?linking=true", onlineOnly: true },
    },
  },
  apiCredentials: [exampleCredential],
  oauthConnections: [exampleOAuthConnection],
};
const exampleNativeApnsDevice = {
  id: "npd_1",
  deviceId: "ios-simulator-1",
  platform: "ios",
  environment: "development",
  tokenPrefix: "apns-token-",
  deviceName: "iPhone",
  appVersion: "1.0.0",
  enabledAt: exampleTimestamp,
  revokedAt: null,
  lastRegisteredAt: exampleTimestamp,
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleNativeSyncProfile = {
  id: exampleChef.id,
  email: "ari@example.com",
  username: exampleChef.username,
  photoUrl: "/photos/profiles/chef_1/avatar.gif",
  updatedAt: exampleTimestamp,
};
const exampleNativeSyncNotificationPreferences = {
  userId: exampleChef.id,
  ...exampleNotificationPreferences,
  updatedAt: exampleTimestamp,
};
const exampleNativeSyncRecipe = {
  ...exampleRecipeDetail,
  deletedAt: null,
};
const exampleNativeSyncCookbook = {
  ...exampleCookbookDetail,
  deletedAt: null,
};
const exampleNativeSyncSpoon = {
  id: "spoon_1",
  chefId: exampleChef.id,
  recipeId: exampleRecipeSummary.id,
  cookedAt: exampleTimestamp,
  photoUrl: null,
  note: "Loved this with extra lemon.",
  nextTime: null,
  deletedAt: null,
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleShoppingItem = {
  id: "item_1",
  name: "eggs",
  quantity: 12,
  unit: "each",
  checked: false,
  checkedAt: null,
  deletedAt: null,
  categoryKey: null,
  iconKey: null,
  sortIndex: 0,
  updatedAt: exampleTimestamp,
};
const exampleNativeSyncShoppingItem = {
  ...exampleShoppingItem,
  shoppingListId: "list_1",
};
const exampleNativeSyncTombstone = {
  resourceType: "recipe",
  resourceId: "recipe_deleted_1",
  parentResourceId: null,
  title: "Archived Pasta",
  deletedAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleNativeSyncEntries = [
  {
    action: "upsert",
    kind: "profile",
    resourceId: exampleChef.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncProfile,
    tombstone: null,
  },
  {
    action: "upsert",
    kind: "notificationPreferences",
    resourceId: exampleChef.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncNotificationPreferences,
    tombstone: null,
  },
  {
    action: "upsert",
    kind: "recipe",
    resourceId: exampleNativeSyncRecipe.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncRecipe,
    tombstone: null,
  },
  {
    action: "upsert",
    kind: "cookbook",
    resourceId: exampleNativeSyncCookbook.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncCookbook,
    tombstone: null,
  },
  {
    action: "upsert",
    kind: "spoon",
    resourceId: exampleNativeSyncSpoon.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncSpoon,
    tombstone: null,
  },
  {
    action: "upsert",
    kind: "shoppingItem",
    resourceId: exampleNativeSyncShoppingItem.id,
    updatedAt: exampleTimestamp,
    payload: exampleNativeSyncShoppingItem,
    tombstone: null,
  },
  {
    action: "delete",
    kind: "recipe",
    resourceId: exampleNativeSyncTombstone.resourceId,
    updatedAt: exampleTimestamp,
    payload: null,
    tombstone: exampleNativeSyncTombstone,
  },
];
const exampleRecipeShoppingItem = {
  ...exampleShoppingItem,
  id: "item_2",
  name: "flour",
  quantity: 4,
  unit: "cup",
  categoryKey: "pantry",
  iconKey: "wheat",
};
const exampleShoppingRecipeReference = { id: "recipe_1", title: "Weeknight Pasta" };
const exampleShoppingList = {
  id: "list_1",
  chef: exampleChef,
  items: [exampleShoppingItem],
  updatedAt: exampleTimestamp,
};
const exampleMutation = { clientMutationId: "device-uuid-1", replayed: false };
const exampleRecipeCover = {
  id: "cover_1",
  recipeId: "recipe_1",
  status: "ready",
  sourceType: "chef-upload",
  imageUrl: "/photos/recipes/chef_1/recipe_1/raw.jpg",
  stylizedImageUrl: "/photos/recipes/chef_1/recipe_1/editorial.jpg",
  displayUrl: "/photos/recipes/chef_1/recipe_1/editorial.jpg",
  activeVariant: "stylized",
  provenanceLabel: "Editorialized chef photo",
  sourceSpoonId: null,
  createdById: "chef_1",
  archivedAt: null,
  generationStatus: "succeeded",
  failureReason: null,
  sourceImageUrl: "/photos/recipes/chef_1/recipe_1/raw.jpg",
  createdAt: exampleTimestamp,
};
const exampleInactiveRecipeCover = {
  ...exampleRecipeCover,
  id: "cover_2",
  stylizedImageUrl: null,
  displayUrl: "/photos/recipes/chef_1/recipe_1/raw-2.jpg",
  activeVariant: null,
  imageUrl: "/photos/recipes/chef_1/recipe_1/raw-2.jpg",
  provenanceLabel: "Chef photo",
  generationStatus: "none",
  sourceImageUrl: "/photos/recipes/chef_1/recipe_1/raw-2.jpg",
};
const exampleProviderSecretBlocker = {
  blocked: true,
  capability: "ProviderSecret",
  command: "Set OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY and rerun the recipe cover mutation.",
  domain: "recipe-covers",
  outputPath: "/tmp/spoonjoy/web/provider-secret-blocker-recipe-covers.json",
  ownerAction: "Provide OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY for local recipe cover editorial generation.",
  reason: "Recipe cover editorial image generation requires an image provider secret.",
};
const exampleRecipeImportProviderSecretBlocker = {
  blocked: true,
  capability: "ProviderSecret",
  command: "Set OPENAI_API_KEY and rerun the recipe import mutation.",
  domain: "recipe-import",
  outputPath: "/tmp/spoonjoy/web/provider-secret-blocker-recipe-import.json",
  ownerAction: "Provide OPENAI_API_KEY for local recipe import extraction and ingredient parsing.",
  reason: "Recipe import requires a provider secret for extraction or ingredient parsing.",
};
const exampleRecipeSpoon = {
  id: "spoon_1",
  chefId: "chef_1",
  recipeId: "recipe_1",
  cookedAt: exampleTimestamp,
  photoUrl: "/photos/spoons/chef_1/recipe_1/cooked.jpg",
  note: "Weeknight win.",
  nextTime: "Add more lemon.",
  deletedAt: null,
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleRecipeSpoonListItem = {
  ...exampleRecipeSpoon,
  chef: { id: "chef_1", username: "ari", photoUrl: "/photos/profiles/chef_1/avatar.gif" },
  coverImageUrl: "/photos/recipes/chef_1/recipe_1/editorial.jpg",
  coverProvenanceLabel: "Editorialized chef photo",
  coverSourceType: "spoon",
  coverVariant: "stylized",
  coverStatus: "ready",
  coverGenerationStatus: "succeeded",
};
const exampleRecipeSpoonNotifications = {
  spoonOnMyRecipe: "skipped",
  fellowChefOriginCook: "queued",
};
const exampleCheckedShoppingItem = { ...exampleShoppingItem, checked: true, checkedAt: exampleTimestamp };
const exampleDeletedShoppingItem = { ...exampleShoppingItem, deletedAt: exampleTimestamp };

const responseExamples: Record<string, unknown> = {
  OpenApiDocument: {
    openapi: "3.1.0",
    info: {
      title: "Spoonjoy API",
      version: "v1",
      description: "Spoonjoy's public-by-default Chef graph plus authenticated token and shopping-list APIs.",
    },
    servers: [{ url: "https://spoonjoy.app" }],
    paths: { "/api/v1/openapi.json": { get: { operationId: "getApiV1OpenApi" } } },
    components: { schemas: { OpenApiDocument: { type: "object" } } },
  },
  SdkOpenApiDocument: {
    openapi: "3.1.0",
    info: {
      title: "Spoonjoy API v1 SDK Profile",
      version: "v1",
      description: "REST-only Spoonjoy API profile for generated SDKs. Browser OAuth redirects, MCP JSON-RPC, connector helpers, cookie auth, and raw spec endpoints are intentionally omitted.",
    },
    servers: [{ url: "https://spoonjoy.app" }],
    paths: { "/api/v1/recipes": { get: { operationId: "getApiV1Recipes" } } },
    components: { schemas: { RecipeListEnvelope: { type: "object" } } },
    "x-sdk-profile": { source: "/api/v1/openapi.json" },
  },
  ConnectorOpenApiDocument: {
    openapi: "3.0.3",
    info: {
      title: "Spoonjoy API v1 Connector Profile",
      version: "v1",
      description: "REST-only Spoonjoy API profile for no-code connector imports.",
    },
    servers: [{ url: "https://spoonjoy.app" }],
    paths: { "/api/v1/shopping-list/sync": { get: { operationId: "getApiV1ShoppingListSync" } } },
    components: { schemas: { ShoppingListSyncEnvelope: { type: "object" } } },
    "x-connector-profile": { source: "/api/v1/openapi.json" },
  },
  DiscoveryEnvelope: {
    ok: true,
    requestId: "req_example",
    data: API_V1_DISCOVERY_DATA,
  },
  HealthEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      ok: true,
      version: "v1",
      authenticated: true,
      principal: examplePrincipal,
      scopes: ["recipes:read"],
    },
  },
  NativeContractEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      status: "declared",
      resource: "native-api-contract",
      message: "This REST contract row is declared for native clients; endpoint-family units replace this example with the handler-specific response shape before returning success.",
    },
  },
  NativeAccountSnapshotEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      me: exampleNativeAccount,
      notifications: {
        pushSubscribed: true,
        preferences: exampleNotificationPreferences,
      },
    },
  },
  NativeProfilePhotoEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      photoUrl: "/photos/profiles/chef_1/avatar.gif",
      me: { id: "chef_1", photoUrl: "/photos/profiles/chef_1/avatar.gif" },
    },
  },
  NativeProfilePhotoRemoveEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      removed: true,
      photoUrl: null,
      me: { id: "chef_1", photoUrl: null },
    },
  },
  NativeNotificationPreferencesEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { preferences: exampleNotificationPreferences },
  },
  NativeApnsDeviceEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { created: true, device: exampleNativeApnsDevice },
  },
  NativeApnsDeviceRevokeEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      revoked: true,
      revokedCount: 1,
      device: { ...exampleNativeApnsDevice, revokedAt: exampleTimestamp },
      devices: [{ ...exampleNativeApnsDevice, revokedAt: exampleTimestamp }],
    },
  },
  NativeOAuthConnectionsEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { connections: [exampleOAuthConnection] },
  },
  NativeOAuthConnectionDisconnectEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { disconnected: true, connection: exampleOAuthConnection },
  },
  NativeSyncEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      freshness: {
        accountId: exampleChef.id,
        environment: "production",
        schemaVersion: 1,
        sourceEndpoint: "/api/v1/me/sync",
        generatedAt: exampleTimestamp,
        lastValidatedAt: exampleTimestamp,
      },
      entries: exampleNativeSyncEntries,
      nextCursor: "v1.eyJ1cGRhdGVkQXQiOiIyMDI2LTA2LTAxVDAwOjAwOjAwLjAwMFoiLCJraW5kIjoic2hvcHBpbmdJdGVtIiwicmVzb3VyY2VJZCI6Iml0ZW1fMSJ9",
      hasMore: false,
    },
  },
  RecipeListEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      query: "pasta",
      limit: 20,
      cursor: null,
      nextCursor: "v1.eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6InJlY2lwZV8xIn0",
      hasMore: false,
      recipes: [exampleRecipeSummary],
    },
  },
  RecipeDetailEnvelope: { ok: true, requestId: "req_example", data: { recipe: exampleRecipeDetail } },
  CreateRecipeEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { created: true, recipe: exampleCreatedRecipeDetail, mutation: exampleMutation },
  },
  UpdateRecipeEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { updated: true, recipe: exampleRecipeDetail, mutation: exampleMutation },
  },
  DeleteRecipeEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { deleted: true, recipe: exampleDeletedRecipe, mutation: exampleMutation },
  },
  ForkRecipeEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { fork: exampleRecipeFork, recipe: exampleForkedRecipeDetail, mutation: exampleMutation },
  },
  RecipeImportEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      recipe: exampleRecipeDetail,
      import: {
        inputType: "url",
        source: "json-ld",
        confidence: "high",
        existingRecipeId: null,
        coverPending: false,
      },
      blockers: [],
      warnings: [],
      nextActions: ["open_recipe"],
      mutation: exampleMutation,
    },
  },
  RecipeImportProviderBlockedEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      recipe: null,
      import: {
        inputType: "text",
        source: null,
        confidence: null,
        existingRecipeId: null,
        coverPending: false,
      },
      blockers: [exampleRecipeImportProviderSecretBlocker],
      warnings: [],
      nextActions: ["Set OPENAI_API_KEY and retry the import with a new clientMutationId."],
      mutation: exampleMutation,
    },
  },
  CreateRecipeStepEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      created: true,
      step: exampleDependentRecipeStep,
      recipe: exampleRecipeDetail,
      mutation: exampleMutation,
    },
  },
  UpdateRecipeStepEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      updated: true,
      step: { ...exampleDependentRecipeStep, description: "Toss pasta with glossy sauce.", duration: null },
      recipe: exampleRecipeDetail,
      mutation: exampleMutation,
    },
  },
  DeleteRecipeStepEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      deleted: true,
      step: { id: "step_2" },
      recipe: exampleRecipeDetailAfterStepDelete,
      mutation: exampleMutation,
    },
  },
  CreateRecipeStepIngredientEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      created: true,
      ingredient: exampleGarlicIngredient,
      step: exampleDependentRecipeStepWithGarlic,
      recipe: exampleRecipeDetailWithGarlic,
      mutation: exampleMutation,
    },
  },
  DeleteRecipeStepIngredientEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      deleted: true,
      ingredient: { id: "ingredient_2" },
      step: exampleDependentRecipeStep,
      recipe: exampleRecipeDetail,
      mutation: exampleMutation,
    },
  },
  ReorderRecipeStepEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      reordered: true,
      step: exampleDependentRecipeStep,
      recipe: exampleRecipeDetail,
      mutation: exampleMutation,
    },
  },
  ReplaceRecipeStepOutputUsesEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      replaced: true,
      step: exampleDependentRecipeStep,
      recipe: exampleRecipeDetail,
      mutation: exampleMutation,
    },
  },
  RecipeCoverListEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      activeCover: exampleRecipeCover,
      covers: [exampleRecipeCover, exampleInactiveRecipeCover],
      pagination: { limit: 20, offset: 0, count: 2, hasMore: false },
      spoonImages: [{
        id: "spoon_1",
        recipeId: "recipe_1",
        chefId: "chef_2",
        photoUrl: "/photos/spoons/chef_2/cooked.jpg",
        cookedAt: exampleTimestamp,
        createdAt: exampleTimestamp,
        updatedAt: exampleTimestamp,
        chef: { id: "chef_2", username: "jules", photoUrl: null },
      }],
    },
  },
  RecipeCoverMutationEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      activeCover: exampleRecipeCover,
      previousActiveCover: null,
      createdCover: exampleRecipeCover,
      generationStatus: "succeeded",
      warnings: [],
      blockers: [exampleProviderSecretBlocker],
      nextActions: ["list_recipe_covers", "get_recipe"],
      mutation: exampleMutation,
    },
  },
  ActiveRecipeCoverMutationEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      activeCover: exampleRecipeCover,
      previousActiveCover: exampleInactiveRecipeCover,
      archivedCover: null,
      warnings: [],
      blockers: [],
      nextActions: ["list_recipe_covers", "get_recipe"],
      mutation: exampleMutation,
    },
  },
  RecipeSpoonListEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      recipeId: "recipe_1",
      limit: 20,
      cursor: null,
      nextCursor: null,
      hasMore: false,
      spoons: [exampleRecipeSpoonListItem],
    },
  },
  CreateRecipeSpoonEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      spoon: exampleRecipeSpoon,
      isOriginCook: true,
      cover: { ...exampleRecipeCover, sourceType: "spoon", sourceSpoonId: exampleRecipeSpoon.id },
      notifications: exampleRecipeSpoonNotifications,
      mutation: exampleMutation,
    },
  },
  UpdateRecipeSpoonEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      spoon: { ...exampleRecipeSpoon, nextTime: "Use more cumin.", updatedAt: exampleTimestamp },
      cover: null,
      mutation: exampleMutation,
    },
  },
  DeleteRecipeSpoonEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      deleted: true,
      spoon: { ...exampleRecipeSpoon, deletedAt: exampleTimestamp },
      mutation: exampleMutation,
    },
  },
  CookbookListEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      query: "weeknight",
      limit: 20,
      cursor: null,
      nextCursor: "v1.eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImNvb2tib29rXzEifQ",
      hasMore: false,
      cookbooks: [exampleCookbookSummary],
    },
  },
  CookbookDetailEnvelope: { ok: true, requestId: "req_example", data: { cookbook: exampleCookbookDetail } },
  CreateCookbookEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { created: true, cookbook: exampleCreatedCookbookDetail, mutation: exampleMutation },
  },
  UpdateCookbookEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      updated: true,
      cookbook: {
        ...exampleCookbookDetail,
        title: "Dinner Parties",
        attribution: {
          creditText: "Dinner Parties by ari on Spoonjoy",
          canonicalUrl: "https://spoonjoy.app/cookbooks/cookbook_1",
        },
      },
      mutation: exampleMutation,
    },
  },
  DeleteCookbookEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { deleted: true, cookbook: exampleDeletedCookbook, mutation: exampleMutation },
  },
  AddRecipeToCookbookEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { added: true, cookbook: exampleCookbookDetail, mutation: exampleMutation },
  },
  AddRecipeToCookbookExistingEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { added: false, cookbook: exampleCookbookDetail, mutation: exampleMutation },
  },
  RemoveRecipeFromCookbookEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      removed: true,
      cookbook: { ...exampleCookbookDetail, recipes: [], recipeCount: 0, coverImageUrls: [] },
      mutation: exampleMutation,
    },
  },
  UserProfileEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      profile: exampleProfileSummary,
      isOwner: false,
      recipes: [exampleProfileRecipe],
      cookbooks: [exampleProfileCookbook],
      recentSpoons: [exampleRecentSpoon],
      fellowChefsCount: 1,
      kitchenVisitorsCount: 1,
    },
  },
  ProfileGraphEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      profile: {
        id: exampleProfileSummary.id,
        username: exampleProfileSummary.username,
        href: exampleProfileSummary.href,
        canonicalUrl: exampleProfileSummary.canonicalUrl,
      },
      page: 1,
      pageSize: 50,
      total: 1,
      nextCursor: null,
      rows: [exampleProfileGraphRow],
    },
  },
  SearchEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      query: "tomato",
      scope: "all",
      limit: 20,
      isAuthenticated: false,
      results: [exampleSearchResult],
    },
  },
  TokenListEnvelope: { ok: true, requestId: "req_example", data: { tokens: [exampleCredential] } },
  CreateTokenEnvelope: { ok: true, requestId: "req_example", data: { token: "sj_secret", credential: exampleCredential } },
  RevokeTokenEnvelope: { ok: true, requestId: "req_example", data: { revoked: true, credential: { ...exampleCredential, revokedAt: exampleTimestamp } } },
  ShoppingListEnvelope: { ok: true, requestId: "req_example", data: { shoppingList: exampleShoppingList, nextCursor: exampleTimestamp } },
  ShoppingListSyncEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      items: [exampleShoppingItem],
      nextCursor: "v1.eyJ1cGRhdGVkQXQiOiIyMDI2LTA2LTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6Iml0ZW1fMSJ9",
      hasMore: false,
    },
  },
  CreateShoppingItemEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { created: true, updated: false, item: exampleShoppingItem, mutation: exampleMutation },
  },
  UpdateShoppingItemEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      item: exampleCheckedShoppingItem,
      mutation: { clientMutationId: "device-uuid-2", replayed: false },
    },
  },
  DeleteShoppingItemEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      removed: true,
      item: exampleDeletedShoppingItem,
      mutation: { clientMutationId: "device-uuid-3", replayed: false },
    },
  },
  AddRecipeToShoppingListEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      created: 1,
      updated: 1,
      recipe: exampleShoppingRecipeReference,
      items: [exampleShoppingItem, exampleRecipeShoppingItem],
      mutation: { clientMutationId: "device-uuid-4", replayed: false },
    },
  },
  ClearShoppingItemsEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      cleared: 1,
      items: [exampleDeletedShoppingItem],
      mutation: { clientMutationId: "device-uuid-5", replayed: false },
    },
  },
};

const requestExamples: Record<string, unknown> = {
  NativeMutationRequest: {
    clientMutationId: "device-uuid-1",
    payload: {
      note: "Endpoint-family units replace this contract placeholder with an exact request schema before handler success ships.",
    },
  },
  RecipeImportRequest: {
    clientMutationId: "device-uuid-import-1",
    source: {
      type: "url",
      url: "https://example.com/recipes/lemon-pasta",
    },
  },
  CreateRecipeRequest: {
    clientMutationId: "device-uuid-1",
    title: "Pasta",
    description: "Weeknight pasta",
    servings: "4",
    steps: [
      {
        stepTitle: null,
        description: "Boil pasta.",
        duration: null,
        ingredients: [{ quantity: 1, unit: "lb", name: "pasta" }],
        outputStepNums: [],
      },
      {
        stepTitle: "Sauce",
        description: "Toss pasta with sauce.",
        duration: 3,
        ingredients: [{ quantity: 2, unit: "cloves", name: "garlic" }],
        outputStepNums: [1],
      },
    ],
  },
  UpdateRecipeRequest: {
    clientMutationId: "device-uuid-2",
    title: "Better Pasta",
    description: null,
    servings: "6",
  },
  DeleteRecipeRequest: { clientMutationId: "device-uuid-3" },
  ForkRecipeRequest: { clientMutationId: "device-uuid-4", title: "My Pasta" },
  CreateRecipeStepRequest: {
    clientMutationId: "step-device-uuid-1",
    stepTitle: "Sauce",
    description: "Toss pasta with sauce.",
    duration: 3,
    ingredients: [{ quantity: 2, unit: "cloves", name: "garlic" }],
    outputStepNums: [1],
  },
  UpdateRecipeStepRequest: {
    clientMutationId: "step-device-uuid-2",
    stepTitle: null,
    description: "Toss pasta with glossy sauce.",
    duration: null,
    outputStepNums: [1],
  },
  DeleteRecipeStepRequest: { clientMutationId: "step-device-uuid-3" },
  CreateRecipeStepIngredientRequest: {
    clientMutationId: "step-ingredient-device-uuid-1",
    quantity: 2,
    unit: "cloves",
    name: "garlic",
  },
  DeleteRecipeStepIngredientRequest: { clientMutationId: "step-ingredient-device-uuid-2" },
  ReorderRecipeStepRequest: {
    clientMutationId: "step-reorder-device-uuid-1",
    stepId: "step_2",
    toStepNum: 2,
  },
  ReplaceRecipeStepOutputUsesRequest: {
    clientMutationId: "step-output-device-uuid-1",
    inputStepId: "step_2",
    outputStepNums: [1],
  },
  RecipeImageUploadRequest: {
    clientMutationId: "cover-upload-device-uuid-1",
    image: "<binary JPG, PNG, or WebP file>",
    activate: true,
    generateEditorial: false,
  },
  CreateRecipeCoverRequest: {
    clientMutationId: "cover-url-device-uuid-1",
    imageUrl: "/photos/recipes/chef_1/uploads/raw.png",
    activate: true,
    generateEditorial: false,
  },
  ActivateRecipeCoverRequest: {
    clientMutationId: "cover-active-device-uuid-1",
    variant: "stylized",
  },
  ArchiveRecipeCoverRequest: {
    clientMutationId: "cover-archive-device-uuid-1",
    replacementCoverId: "cover_2",
    replacementVariant: "image",
    confirmNoCover: false,
    deleteSafeObjects: false,
  },
  RegenerateRecipeCoverRequest: {
    clientMutationId: "cover-regenerate-device-uuid-1",
    coverId: "cover_1",
    activateWhenReady: true,
  },
  RecipeCoverFromSpoonRequest: {
    clientMutationId: "cover-spoon-device-uuid-1",
    activate: true,
    generateEditorial: false,
  },
  CreateRecipeSpoonRequest: {
    clientMutationId: "spoon-create-device-uuid-1",
    note: "Weeknight win.",
    nextTime: "Add more lemon.",
    cookedAt: exampleTimestamp,
    photoUrl: null,
    useAsRecipeCover: false,
  },
  CreateRecipeSpoonPhotoUploadRequest: {
    clientMutationId: "spoon-photo-device-uuid-1",
    photo: "<binary JPG, PNG, or WebP file>",
    note: "First cook photo.",
    nextTime: null,
    cookedAt: exampleTimestamp,
    useAsRecipeCover: true,
  },
  UpdateRecipeSpoonRequest: {
    clientMutationId: "spoon-update-device-uuid-1",
    note: null,
    nextTime: "Use more cumin.",
    cookedAt: exampleTimestamp,
    photoUrl: "/photos/spoons/chef_1/recipe_1/cooked.jpg",
  },
  DeleteRecipeSpoonRequest: { clientMutationId: "spoon-delete-device-uuid-1" },
  CreateCookbookRequest: {
    clientMutationId: "cookbook-create-device-uuid-1",
    title: "Packed Lunches",
  },
  UpdateCookbookRequest: {
    clientMutationId: "cookbook-update-device-uuid-1",
    title: "Dinner Parties",
  },
  DeleteCookbookRequest: { clientMutationId: "cookbook-delete-device-uuid-1" },
  CookbookRecipeMutationRequest: { clientMutationId: "cookbook-recipe-device-uuid-1" },
  NativeProfileRequest: { email: "ari@example.com", username: "ari" },
  ProfilePhotoUploadRequest: { photo: "<binary image file>" },
  NativeNotificationPreferencesRequest: {
    notifySpoonOnMyRecipe: false,
    notifyForkOfMyRecipe: true,
    notifyCookbookSaveOfMine: false,
    notifyFellowChefOriginCook: true,
  },
  NativeApnsDeviceRequest: {
    deviceId: "ios-simulator-1",
    platform: "ios",
    environment: "development",
    token: "apns-token-...",
    deviceName: "iPhone",
    appVersion: "1.0.0",
  },
  CreateTokenRequest: { name: "Tiny client", scopes: ["recipes:read", "shopping_list:read", "shopping_list:write"] },
  CreateShoppingItemRequest: {
    clientMutationId: "device-uuid-1",
    name: "Eggs",
    quantity: 12,
    unit: "Each",
    categoryKey: null,
    iconKey: null,
  },
  CheckShoppingItemRequest: { clientMutationId: "device-uuid-2", checked: true },
  DeleteShoppingItemRequest: { clientMutationId: "device-uuid-3" },
  AddRecipeToShoppingListRequest: { clientMutationId: "device-uuid-4", recipeId: "recipe_1", scaleFactor: 2 },
  ClearShoppingItemsRequest: { clientMutationId: "device-uuid-5" },
};

function requestContentFor(schemaName: string) {
  if (schemaName === "ProfilePhotoUploadRequest" || schemaName === "RecipeImageUploadRequest") {
    return {
      "multipart/form-data": {
        schema: ref(schemaName),
        examples: {
          example: { value: requestExamples[schemaName] },
        },
      },
    };
  }
  if (schemaName === "CreateRecipeSpoonRequest") {
    return {
      ...jsonContent(ref("CreateRecipeSpoonRequest"), requestExamples.CreateRecipeSpoonRequest),
      "multipart/form-data": {
        schema: ref("CreateRecipeSpoonPhotoUploadRequest"),
        examples: {
          example: { value: requestExamples.CreateRecipeSpoonPhotoUploadRequest },
        },
      },
    };
  }
  return jsonContent(ref(schemaName), requestExamples[schemaName]);
}

const errorMessages: Record<ApiV1ErrorCode, string> = {
  invalid_json: "Invalid JSON body",
  validation_error: "Request validation failed",
  invalid_cursor: "cursor must be a valid Spoonjoy cursor",
  invalid_scope: "Unknown API credential scope: recipes:delete",
  authentication_required: "Authentication required",
  invalid_token: "Invalid API token",
  insufficient_scope: "Missing required scope",
  not_found: "Resource not found",
  method_not_allowed: "Method not allowed",
  idempotency_conflict: "Idempotency key was already used for a different request",
  idempotency_in_progress: "Idempotency key is already in progress; retry shortly",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
};

function successResponse(schemaName: string, options: { publicCache?: boolean; noStore?: boolean }) {
  const headers: Record<string, unknown> = {
    "X-Request-Id": {
      description: "Request identifier generated by Spoonjoy or echoed from the request.",
      schema: { type: "string" },
    },
  };
  if (options.publicCache) {
    headers["Cache-Control"] = {
      description: "Present on anonymous public read responses: public, max-age=60, stale-while-revalidate=300. Authenticated public reads validate scopes and are not public-cacheable; shopping-list search results are always private.",
      schema: { type: "string" },
    };
    headers.Vary = {
      description: "Present with public cache headers so shared caches vary by credentials.",
      schema: { type: "string", example: "Authorization, Cookie" },
    };
  }
  if (options.noStore) {
    headers["Cache-Control"] = {
      description: "Authenticated/private response. Clients and intermediaries must not store it.",
      schema: { type: "string", example: "private, no-store" },
    };
    headers.Pragma = {
      description: "Legacy no-cache companion header for authenticated/private responses.",
      schema: { type: "string", example: "no-cache" },
    };
  }
  return {
    description: "Success",
    headers,
    content: jsonContent(ref(schemaName), responseExamples[schemaName]),
  };
}

function errorMessageFor(code: ApiV1ErrorCode, scopes: readonly string[]) {
  return code === "insufficient_scope" && scopes[0]
    ? `Missing required scope: ${scopes[0]}`
    : errorMessages[code];
}

function errorExampleFor(code: ApiV1ErrorCode, scopes: readonly string[]) {
  return {
    ok: false,
    requestId: "req_example",
    error: {
      code,
      message: errorMessageFor(code, scopes),
      status: API_V1_ERROR_STATUS[code],
      ...(code === "idempotency_in_progress" ? { details: { retryAfterSeconds: 2 } } : {}),
    },
  };
}

function errorResponse(codes: ApiV1ErrorCode[], scopes: readonly string[]) {
  return {
    description: `Errors: ${codes.join(", ")}`,
    headers: {
      "X-Request-Id": {
        description: "Request identifier generated by Spoonjoy or echoed from the request.",
        schema: { type: "string" },
      },
      "Cache-Control": {
        description: "Error envelopes are not cacheable.",
        schema: { type: "string", example: "private, no-store" },
      },
      ...(codes.includes("rate_limited") || codes.includes("idempotency_in_progress")
        ? {
            "Retry-After": {
              description: "Seconds to wait before retrying the rate-limited or still-running idempotent request.",
              schema: { type: "integer" },
            },
          }
        : {}),
    },
    content: jsonContentExamples(
      ref("ErrorEnvelope"),
      Object.fromEntries(codes.map((code) => [code, errorExampleFor(code, scopes)])),
    ),
  };
}

function errorCodesByStatus(codes: ApiV1ErrorCode[]) {
  const grouped = new Map<number, ApiV1ErrorCode[]>();
  for (const code of codes) {
    const status = API_V1_ERROR_STATUS[code];
    grouped.set(status, [...(grouped.get(status) ?? []), code]);
  }
  return grouped;
}

function scopeRequirementForOperation(path: ResourcePath, method: HttpMethod) {
  return API_V1_SCOPE_REQUIREMENTS.find((requirement) => (
    requirement.path === path && requirement.method === method
  ))!;
}

function oauthAppliesToScopes(scopes: readonly string[]) {
  return scopes.some((scope) => !scope.startsWith("tokens:") && scope !== "offline_access");
}

function credentialModesFor(auth: OperationAuth, scopes: readonly string[]): CredentialMode[] {
  const modes: CredentialMode[] = auth === "bearer" ? ["session", "bearer"] : ["anonymous", "session", "bearer"];
  if (oauthAppliesToScopes(scopes)) modes.push("oauth_pkce");
  return modes;
}

function dedupeSecurityRequirements(requirements: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = JSON.stringify(requirement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function securityFor(auth: OperationAuth, scopes: readonly string[]) {
  const oauthScopes = scopes.filter((scope) => !scope.startsWith("tokens:") && scope !== "offline_access");
  const oauthAlternatives = acceptedOauthScopeSets(scopes).map((scopeSet) => ({ oauth2: scopeSet }));
  const publicScopeAlternative = oauthScopes.some((scope) => scope === "recipes:read" || scope === "cookbooks:read")
    ? [{ oauth2: ["public:read"] }]
    : [];
  if (auth === "bearer") {
    return oauthScopes.length > 0
      ? dedupeSecurityRequirements([{ bearerAuth: [] }, { cookieAuth: [] }, { oauth2: oauthScopes }, ...oauthAlternatives])
      : dedupeSecurityRequirements([{ bearerAuth: [] }, { cookieAuth: [] }]);
  }
  if (scopes.length > 0) return dedupeSecurityRequirements([{}, { bearerAuth: [] }, { cookieAuth: [] }, { oauth2: oauthScopes }, ...oauthAlternatives, ...publicScopeAlternative]);
  return dedupeSecurityRequirements([{}]);
}

function acceptedOauthScopeSets(scopes: readonly string[]) {
  const alternatives: string[][] = [];
  if (scopes.some((scope) => scope === "recipes:read" || scope === "cookbooks:read" || scope === "public:read" || scope === "shopping_list:read")) {
    alternatives.push(["kitchen:read"]);
  }
  if (scopes.some((scope) => scope === "recipes:read" || scope === "cookbooks:read")) {
    alternatives.push(["public:read"]);
  }
  if (scopes.includes("shopping_list:write")) {
    alternatives.push(["kitchen:write"]);
  }
  return alternatives.filter((alternative) => !alternative.every((scope) => scopes.includes(scope)));
}

function retryPolicyFor(path: ResourcePath, method: HttpMethod) {
  if (path === "/api/v1/tokens" && method === "POST") {
    return {
      automaticRetry: false,
      retryOn: ["429"],
      retryAfterHeader: "Retry-After",
      reason: "Creates a one-time-display bearer secret. Do not auto-retry network timeouts or 5xx responses because a successful first attempt may have returned a token the client did not receive.",
    };
  }
  const isMutation = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  if (path.startsWith("/api/v1/shopping-list/items")) {
    return {
      retryOn: ["network_timeout", "429", "5xx", "idempotency_in_progress"],
      retryAfterHeader: "Retry-After",
      preserveClientMutationId: true,
      doNotRetryUnchanged: ["validation_error", "insufficient_scope", "idempotency_conflict"],
    };
  }
  if (isMutation && (path.startsWith("/api/v1/recipes") || path.startsWith("/api/v1/cookbooks"))) {
    return {
      retryOn: ["network_timeout", "429", "5xx", "idempotency_in_progress"],
      retryAfterHeader: "Retry-After",
      preserveClientMutationId: true,
      doNotRetryUnchanged: ["validation_error", "insufficient_scope", "idempotency_conflict"],
    };
  }
  return {
    retryOn: isMutation ? ["network_timeout", "429", "5xx"] : ["network_timeout", "429", "5xx"],
    retryAfterHeader: "Retry-After",
    preserveClientMutationId: false,
    doNotRetryUnchanged: ["validation_error", "invalid_cursor", "insufficient_scope"],
  };
}

function cursorPolicyFor(path: ResourcePath) {
  if (path === "/api/v1/shopping-list") {
    return {
      returnsBootstrapCursor: true,
      nextEndpoint: "/api/v1/shopping-list/sync",
      store: "Pass data.nextCursor to /api/v1/shopping-list/sync after applying the list response.",
    };
  }
  if (path === "/api/v1/shopping-list/sync") {
    return {
      cursor: "opaque",
      limit: { min: 1, max: 50, default: 20 },
      store: "Persist data.nextCursor for each page only after applying every returned item and tombstone durably. When hasMore is true, immediately continue from that checkpoint to drain the backlog.",
      tombstones: "Rows with deletedAt are removals.",
    };
  }
  if (path === "/api/v1/me/sync") {
    return {
      cursor: "opaque",
      limit: { min: 1, max: 50, default: 20 },
      order: "updatedAt, domain priority, resource id",
      store: "Persist data.nextCursor for each page only after applying every entry and tombstone durably. When hasMore is true, immediately continue from that checkpoint to drain the current-chef cache backlog.",
      tombstones: "Entries with action=delete contain a tombstone and null payload. Active entries use action=upsert.",
    };
  }
  if (path === "/api/v1/recipes" || path === "/api/v1/cookbooks") {
    return {
      cursor: "opaque",
      limit: { min: 1, max: 50, default: 20 },
      order: "createdAt/id cursor walk",
      caveat: "Not an updatedAt incremental feed and not a repeatable snapshot guarantee.",
    };
  }
  return null;
}

function idempotencyPolicyFor(path: ResourcePath, method: HttpMethod) {
  if (path === "/api/v1/recipes" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [201],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/recipes/{id}" && method === "PATCH") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/recipes/{id}" && method === "DELETE") {
    return {
      key: "clientMutationId",
      location: "jsonBodyOrXClientMutationIdHeader",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
    };
  }
  if (path === "/api/v1/recipes/{id}/fork" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [201],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/recipes/import" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [201, 202],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId, including the source type and content. Provider-secret blocker responses replay just like completed recipe imports.",
    };
  }
  if (path === "/api/v1/cookbooks" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [201],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/cookbooks/{id}" && method === "PATCH") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (
    (path === "/api/v1/cookbooks/{id}" && method === "DELETE") ||
    (path === "/api/v1/cookbooks/{id}/recipes/{recipeId}" && method === "DELETE")
  ) {
    return {
      key: "clientMutationId",
      location: "jsonBodyOrXClientMutationIdHeaderOrQuery",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId, or the same X-Client-Mutation-Id header/query value when the DELETE body is omitted. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/cookbooks/{id}/recipes/{recipeId}" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200, 201],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (
    (
      path === "/api/v1/recipes/{id}/steps" ||
      path === "/api/v1/recipes/{id}/steps/{stepId}" ||
      path === "/api/v1/recipes/{id}/steps/reorder" ||
      path === "/api/v1/recipes/{id}/steps/{stepId}/ingredients" ||
      path === "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}" ||
      path === "/api/v1/recipes/{id}/step-output-uses"
    ) &&
    (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE")
  ) {
    const acceptsDeleteFallback = method === "DELETE" && (
      path === "/api/v1/recipes/{id}/steps/{stepId}" ||
      path === "/api/v1/recipes/{id}/steps/{stepId}/ingredients/{ingredientId}"
    );
    return {
      key: "clientMutationId",
      location: acceptsDeleteFallback ? "jsonBodyOrXClientMutationIdHeaderOrQuery" : "jsonBody",
      retentionHours: 24,
      replayStatus: [method === "POST" && (path === "/api/v1/recipes/{id}/steps" || path === "/api/v1/recipes/{id}/steps/{stepId}/ingredients") ? 201 : 200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: acceptsDeleteFallback
        ? "Persist and retry the same parsed JSON body for this clientMutationId, or the same X-Client-Mutation-Id header/query value when the DELETE body is omitted. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts."
        : "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/shopping-list/items" && method === "POST") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200, 201],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/shopping-list/items/{itemId}" && method === "PATCH") {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  if (path === "/api/v1/shopping-list/items/{itemId}" && method === "DELETE") {
    return {
      key: "X-Client-Mutation-Id",
      location: "header",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
    };
  }
  if (
    (
      path === "/api/v1/shopping-list/add-from-recipe" ||
      path === "/api/v1/shopping-list/clear-completed" ||
      path === "/api/v1/shopping-list/clear-all"
    ) &&
    method === "POST"
  ) {
    return {
      key: "clientMutationId",
      location: "jsonBody",
      retentionHours: 24,
      replayStatus: [200],
      conflictStatus: 409,
      inProgressRetryAfterSeconds: 2,
      retryBodyRule: "Persist and retry the same parsed JSON body for this clientMutationId. Spoonjoy canonicalizes object key order and ignores whitespace, but method, path, and body values still define conflicts.",
    };
  }
  return null;
}

function operationExtensions(path: ResourcePath, method: HttpMethod) {
  const cursorPolicy = cursorPolicyFor(path);
  const idempotencyPolicy = idempotencyPolicyFor(path, method);
  return {
    "x-retry-policy": retryPolicyFor(path, method),
    ...(cursorPolicy ? { "x-cursor-policy": cursorPolicy } : {}),
    ...(idempotencyPolicy ? { "x-idempotency": idempotencyPolicy } : {}),
    ...(path === "/api/v1/tokens" || path === "/api/v1/tokens/{credentialId}"
      ? {
          "x-personal-token-only": true,
          "x-oauth-note": "OAuth-issued access tokens never grant tokens:read or tokens:write. Use a Spoonjoy session or a personal bearer credential for token management.",
        }
      : {}),
    ...(path === "/api/v1/tokens/{credentialId}" && method === "DELETE"
      ? {
          "x-self-revoke-exception": "A bearer credential may revoke its own credential id without tokens:write. Revoking any other credential still requires tokens:write.",
        }
      : {}),
    ...(path === "/api/v1/search" && method === "GET"
      ? {
          "x-private-scope-policy": {
            shoppingListResultsRequireAny: ["shopping_list:read", "kitchen:read"],
            explicitShoppingListWithoutAuth: "401 authentication_required",
            explicitShoppingListWithoutScope: "403 insufficient_scope",
            allScopeWithoutPrivateScope: "Public results only; shopping-list items are omitted.",
          },
        }
      : {}),
  };
}

const oauthRegisterExample = {
  client_name: "Grocery helper",
  redirect_uris: ["https://example.com/oauth/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};
const oauthRegisterResponseExample = {
  client_id: "cm_client_id_from_register",
  client_name: "Grocery helper",
  redirect_uris: ["https://example.com/oauth/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};
const oauthTokenRequestExample = {
  grant_type: "authorization_code",
  client_id: "cm_client_id_from_register",
  redirect_uri: "https://example.com/oauth/callback",
  code: "oac_...",
  code_verifier: "pkce_verifier_0123456789_abcdefghijklmnopqrstuvwxyz_ABCDEF",
};
const oauthRefreshRequestExample = {
  grant_type: "refresh_token",
  client_id: "cm_client_id_from_register",
  refresh_token: "ort_...",
};
const oauthRevokeRequestExample = {
  token: "ort_...",
  client_id: "cm_client_id_from_register",
  token_type_hint: "refresh_token",
};
const oauthTokenResponseExample = {
  access_token: "sj_...",
  refresh_token: "ort_...",
  token_type: "Bearer",
  expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  scope: "shopping_list:read shopping_list:write",
};
const oauthErrorExample = { error: "invalid_scope", error_description: "Unsupported scope: tokens:write" };
const oauthRateLimitExample = {
  error: "rate_limited",
  message: "Too many requests",
  retryAfterSeconds: 60,
};
function oauthRateLimitResponse() {
  return {
    description: "Rate limited. This is the generic Spoonjoy rate-limit shape, not a standard OAuth error.",
    headers: {
      "Retry-After": {
        description: "Seconds to wait before retrying.",
        schema: { type: "integer" },
      },
    },
    content: jsonContent(ref("RateLimitResponse"), oauthRateLimitExample),
  };
}
const agentStartRequestExample = { agentName: "Kitchen display", scopes: "shopping_list:read shopping_list:write" };
const agentStartResponseExample = {
  ok: true,
  data: {
    deviceCode: "sjdc_...",
    userCode: "ABCD-2345",
    authorizationUrl: "https://spoonjoy.app/agent/connect/acr_123?code=ABCD-2345",
    verificationUri: "https://spoonjoy.app/agent/connect",
    verificationUriComplete: "https://spoonjoy.app/agent/connect/acr_123?code=ABCD-2345",
    expiresAt: exampleTimestamp,
    expiresIn: 600,
    interval: 2,
    message: "Send authorizationUrl to the user, or show verificationUri plus userCode on constrained devices. After approval, call poll_agent_connection with deviceCode. Never ask for their Spoonjoy password.",
  },
};
const agentPollRequestExample = { deviceCode: "sjdc_..." };
const agentPollPendingExample = {
  ok: true,
  data: {
    status: "pending",
    expiresAt: exampleTimestamp,
    authorizationUrl: "https://spoonjoy.app/agent/connect/acr_123?code=ABCD-2345",
    verificationUri: "https://spoonjoy.app/agent/connect",
    verificationUriComplete: "https://spoonjoy.app/agent/connect/acr_123?code=ABCD-2345",
    userCode: "ABCD-2345",
    message: "Waiting for the user to approve this Spoonjoy connection.",
  },
};
const agentPollApprovedExample = {
  ok: true,
  data: {
    status: "approved",
    expiresAt: exampleTimestamp,
    token: "sj_...",
	    credential: {
	      id: "cred_1",
	      name: "Kitchen display delegated token",
	      tokenPrefix: "sj_abc123456",
	      scopes: ["shopping_list:read", "shopping_list:write"],
	      createdAt: exampleTimestamp,
	      expiresAt: null,
	    },
    message: "Connection approved. Cache this token locally and use it for future Spoonjoy calls.",
  },
};
const agentPollDeniedExample = { ok: true, data: { status: "denied", expiresAt: exampleTimestamp, message: "Connection request was denied." } };
const agentPollExpiredExample = { ok: true, data: { status: "expired", expiresAt: exampleTimestamp, message: "Connection request expired." } };
const agentPollClaimedExample = { ok: true, data: { status: "claimed", expiresAt: exampleTimestamp, message: "Connection request was already claimed." } };
const legacyToolErrorExample = {
  ok: false,
  error: { message: "deviceCode is required", status: 400 },
};
const mcpRequestExample = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const mcpResponseExample = { jsonrpc: "2.0", id: 1, result: { tools: [] } };

function authOperationPaths() {
  return {
    "/oauth/register": {
      post: {
        operationId: "postOAuthRegister",
        tags: ["OAuth"],
        summary: "Register a public OAuth client",
        "x-auth": "optional",
        "x-scopes": [],
        "x-credential-modes": ["anonymous"],
        security: [{}],
        requestBody: {
          required: true,
          content: jsonContent(ref("OAuthRegisterRequest"), oauthRegisterExample),
        },
        responses: {
          201: { description: "Registered client", content: jsonContent(ref("OAuthRegisterResponse"), oauthRegisterResponseExample) },
          400: { description: "OAuth error", content: jsonContent(ref("OAuthErrorResponse"), oauthErrorExample) },
          429: oauthRateLimitResponse(),
        },
      },
    },
    "/oauth/authorize": {
      get: {
        operationId: "getOAuthAuthorize",
        tags: ["OAuth"],
        summary: "Redirect the chef through OAuth consent",
        "x-auth": "optional",
        "x-scopes": [],
        "x-grantable-scopes": ["cookbooks:read", "kitchen:read", "kitchen:write", "public:read", "recipes:read", "shopping_list:read", "shopping_list:write"],
        "x-credential-modes": ["anonymous", "session"],
        security: [{}, { cookieAuth: [] }],
        parameters: [
          { name: "response_type", in: "query", required: true, schema: { type: "string", const: "code", default: "code" } },
          { name: "client_id", in: "query", required: true, schema: idSchema },
          { name: "redirect_uri", in: "query", required: true, schema: redirectUriSchema },
          { name: "scope", in: "query", required: false, description: "Requested grant scopes. Omit for Spoonjoy's runtime default of kitchen:read; shopping-list apps should explicitly request shopping_list:read shopping_list:write.", "x-recommended-scope": "shopping_list:read shopping_list:write", schema: { type: "string", examples: ["kitchen:read", "shopping_list:read shopping_list:write"] } },
          { name: "state", in: "query", required: true, description: "Opaque client state generated per authorization attempt and verified after the redirect callback.", schema: { type: "string", minLength: 16, examples: ["state_random_32_chars_per_attempt"] } },
          { name: "code_challenge", in: "query", required: true, schema: { type: "string" } },
          { name: "code_challenge_method", in: "query", required: true, schema: { type: "string", const: "S256", default: "S256" } },
          { name: "resource", in: "query", required: false, description: "Protected resource audience. Use https://spoonjoy.app/mcp only for MCP OAuth; omit for REST OAuth apps.", schema: uriSchema },
        ],
        responses: {
          302: { description: "Redirects to login, consent, callback, or client error with state preserved." },
          200: { description: "Renders Spoonjoy consent HTML for a signed-in chef." },
        },
      },
    },
    "/oauth/token": {
      post: {
        operationId: "postOAuthToken",
        tags: ["OAuth"],
        summary: "Exchange or refresh an OAuth token",
        "x-auth": "optional",
        "x-scopes": [],
        "x-credential-modes": ["anonymous"],
        security: [{}],
        requestBody: {
          required: true,
          content: formContentExamples({ oneOf: [ref("OAuthTokenCodeRequest"), ref("OAuthTokenRefreshRequest")] }, {
            authorization_code: oauthTokenRequestExample,
            refresh_token: oauthRefreshRequestExample,
          }),
        },
        responses: {
          200: {
            description: "Token response",
            headers: {
              "Cache-Control": {
                description: "Always no-store for token-bearing responses.",
                schema: { type: "string", example: "no-store" },
              },
              Pragma: {
                description: "Always no-cache for token-bearing responses.",
                schema: { type: "string", example: "no-cache" },
              },
            },
            content: jsonContent(ref("OAuthTokenResponse"), oauthTokenResponseExample),
          },
          400: { description: "OAuth error", content: jsonContent(ref("OAuthErrorResponse"), oauthErrorExample) },
          429: oauthRateLimitResponse(),
        },
      },
    },
    "/oauth/revoke": {
      post: {
        operationId: "postOAuthRevoke",
        tags: ["OAuth"],
        summary: "Revoke a rotating OAuth refresh token",
        "x-auth": "optional",
        "x-scopes": [],
        "x-credential-modes": ["anonymous"],
        security: [{}],
        requestBody: {
          required: true,
          content: formContentExamples(ref("OAuthRevokeRequest"), {
            refresh_token: oauthRevokeRequestExample,
          }),
        },
        responses: {
          204: { description: "Refresh token revoked or already unusable." },
          400: { description: "OAuth error", content: jsonContent(ref("OAuthErrorResponse"), oauthErrorExample) },
          429: oauthRateLimitResponse(),
        },
      },
    },
    "/api/tools/start_agent_connection": {
      post: {
        operationId: "postStartAgentConnection",
        tags: ["Agent Approval"],
        summary: "Start a delegated approval connection",
        "x-auth": "optional",
        "x-scopes": [],
        "x-grantable-scopes": ["kitchen:read", "kitchen:write", "shopping_list:read", "shopping_list:write"],
        "x-credential-modes": ["anonymous"],
        security: [{}],
        requestBody: {
          required: false,
          content: jsonContent(ref("AgentStartRequest"), agentStartRequestExample),
        },
        responses: {
          200: { description: "Delegated connection started", content: jsonContent(ref("AgentStartEnvelope"), agentStartResponseExample) },
          400: { description: "Tool error", content: jsonContent(ref("LegacyToolErrorEnvelope"), legacyToolErrorExample) },
          429: oauthRateLimitResponse(),
        },
      },
    },
    "/api/tools/poll_agent_connection": {
      post: {
        operationId: "postPollAgentConnection",
        tags: ["Agent Approval"],
        summary: "Poll a delegated approval connection",
        "x-auth": "optional",
        "x-scopes": [],
        "x-credential-modes": ["anonymous"],
        security: [{}],
        requestBody: {
          required: true,
          content: jsonContent(ref("AgentPollRequest"), agentPollRequestExample),
        },
        responses: {
          200: {
            description: "Pending or approved delegated connection",
            content: jsonContentExamples(ref("AgentPollEnvelope"), {
              pending: agentPollPendingExample,
              approved: agentPollApprovedExample,
              denied: agentPollDeniedExample,
              expired: agentPollExpiredExample,
              claimed: agentPollClaimedExample,
            }),
          },
          400: { description: "Tool error", content: jsonContent(ref("LegacyToolErrorEnvelope"), legacyToolErrorExample) },
          429: oauthRateLimitResponse(),
        },
      },
    },
    "/mcp": {
      post: {
        operationId: "postMcp",
        tags: ["MCP"],
        summary: "Call the remote Spoonjoy MCP endpoint",
        "x-auth": "bearer",
        "x-scopes": ["kitchen:read", "kitchen:write"],
        "x-credential-modes": ["bearer", "oauth_pkce"],
        security: [{ bearerAuth: [] }, { oauth2: ["kitchen:read", "kitchen:write"] }],
        requestBody: {
          required: true,
          content: jsonContent(ref("McpJsonRpcRequest"), mcpRequestExample),
        },
        responses: {
          200: { description: "JSON-RPC response", content: jsonContent(ref("McpJsonRpcResponse"), mcpResponseExample) },
          401: { description: "OAuth bearer challenge. See WWW-Authenticate and .well-known/oauth-protected-resource." },
          429: oauthRateLimitResponse(),
        },
      },
    },
  };
}

export function buildApiV1OpenApiDocument(options: BuildOpenApiOptions = {}) {
  const serverUrl = serverUrlFor(options);
  const paths: Record<string, Record<string, unknown>> = {};

  for (const path of Object.keys(operationMeta) as ResourcePath[]) {
    paths[path] = {};
    for (const method of Object.keys(operationMeta[path]) as HttpMethod[]) {
      const meta = operationMeta[path][method]!;
      const requirement = scopeRequirementForOperation(path, method);
      const responses: Record<string, unknown> = {};
      for (const [status, schemaName] of Object.entries(meta.success)) {
        responses[status] = successResponse(schemaName, {
          publicCache: (
            path === "/api/v1/recipes" ||
            path === "/api/v1/recipes/{id}" ||
            path === "/api/v1/cookbooks" ||
            path === "/api/v1/cookbooks/{id}" ||
            path === "/api/v1/users/{identifier}" ||
            path === "/api/v1/users/{identifier}/fellow-chefs" ||
            path === "/api/v1/users/{identifier}/kitchen-visitors" ||
            path === "/api/v1/search"
          ),
          noStore: requirement.auth === "bearer",
        });
      }
      for (const [status, codes] of errorCodesByStatus(meta.errors)) {
        responses[String(status)] = errorResponse(codes, meta.errorScopes ?? requirement.scopes);
      }

      const parameters = [...(meta.parameters ?? []), pathParameters.requestIdHeader];

      paths[path][method.toLowerCase()] = {
        operationId: meta.operationId,
        tags: meta.tags,
        summary: meta.summary,
        "x-auth": requirement.auth,
        "x-scopes": [...requirement.scopes],
        "x-accepted-oauth-scopes": acceptedOauthScopeSets(requirement.scopes),
        "x-credential-modes": credentialModesFor(requirement.auth, requirement.scopes),
        ...operationExtensions(path, method),
        security: securityFor(requirement.auth, requirement.scopes),
        parameters,
        ...(meta.requestBody
          ? {
              requestBody: {
                required: meta.requestBodyRequired ?? true,
                content: requestContentFor(meta.requestBody),
              },
            }
          : {}),
        responses,
      };
    }
  }

  Object.assign(paths, authOperationPaths());

  return {
    openapi: "3.1.0",
    info: {
      title: "Spoonjoy API",
      version: "v1",
      description: "Spoonjoy's public-by-default Chef graph plus authenticated token and shopping-list APIs.",
    },
    servers: [{ url: serverUrl }],
    security: [],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Spoonjoy API token",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "__session",
          description: "Same-origin Spoonjoy browser session cookie. Use only from spoonjoy.app; external clients should use bearerAuth or OAuth/PKCE.",
        },
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: absoluteApiUrl(serverUrl, "/oauth/authorize"),
              tokenUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
              refreshUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
              scopes: {
                "cookbooks:read": "Least-privilege delegated access to public cookbook reads.",
                "kitchen:read": "Delegated read access to public recipes, public cookbooks, and the chef's shopping list.",
                "kitchen:write": "Delegated write access for MCP kitchen tools and shopping-list mutations. Does not include token management.",
                "public:read": "Least-privilege delegated access to public Spoonjoy data.",
                "recipes:read": "Least-privilege delegated access to public recipe reads.",
                "shopping_list:read": "Least-privilege delegated access to the chef's shopping list.",
                "shopping_list:write": "Least-privilege delegated access to add, check, and remove shopping-list items.",
              },
            },
          },
          description: "Public OAuth/PKCE clients self-register with POST /oauth/register, then use authorization_code plus rotating refresh_token grants.",
        },
      },
      schemas,
    },
    "x-oauth-scope-map": {
      "kitchen:read": ["cookbooks:read", "kitchen:read", "public:read", "recipes:read", "shopping_list:read"],
      "kitchen:write": ["kitchen:write", "shopping_list:write"],
      "shopping_list:read": ["shopping_list:read"],
      "shopping_list:write": ["shopping_list:write"],
      "recipes:read": ["recipes:read"],
      "cookbooks:read": ["cookbooks:read"],
      "public:read": ["cookbooks:read", "public:read", "recipes:read"],
    },
    "x-oauth-discovery": {
      authorizationServerMetadataUrl: absoluteApiUrl(serverUrl, "/.well-known/oauth-authorization-server"),
      protectedResourceMetadataUrl: absoluteApiUrl(serverUrl, "/.well-known/oauth-protected-resource"),
      authorizationUrl: absoluteApiUrl(serverUrl, "/oauth/authorize"),
      tokenUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
      refreshUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
      revokeUrl: absoluteApiUrl(serverUrl, "/oauth/revoke"),
      dynamicRegistrationUrl: absoluteApiUrl(serverUrl, "/oauth/register"),
      pkce: "S256",
      tokenEndpointAuthMethod: "none",
    },
    "x-public-data-policy": {
      termsUrl: absoluteApiUrl(serverUrl, "/terms"),
      allowed: [
        "lightweight public embeds with visible Spoonjoy attribution and linkback",
        "public catalog search, crawling, and internal analytics that respect rate limits",
        "personal or operational use of public recipe/cookbook metadata returned by API v1",
      ],
      notGranted: [
        "commercial republication of complete recipes or datasets without permission",
        "copying, storing, or redistributing Spoonjoy or source-site photos as your own assets",
        "bypassing later removals, 404s, or source-owner rights",
      ],
      attribution: "Show attribution.creditText and link it to attribution.canonicalUrl whenever public Spoonjoy content is displayed outside Spoonjoy.",
      removal: "Hide or remove mirrored public content when a later fetch returns 404 not_found. Public catalog endpoints do not emit recipe/cookbook deletion tombstones in v1.",
      crawling: "Follow cursors serially or with conservative concurrency, respect Retry-After, and restart full crawls periodically to catch edits/removals.",
      photos: "Use coverImageUrl or coverImageUrls only for transient display in contexts where removals can be honored; API v1 does not provide alt text or a photo-copying license.",
    },
    "x-auth-flows": [
      {
        id: "oauth-pkce",
        title: "OAuth/PKCE delegated app",
        eyebrow: "Mobile, SaaS, extension",
        audience: "Use for third-party apps that can receive a redirect callback and should never handle a chef password.",
        endpoints: ["/.well-known/oauth-authorization-server", "/oauth/register", "/oauth/authorize", "/oauth/token", "/oauth/revoke"],
        scopes: ["kitchen:read", "kitchen:write", "shopping_list:read", "shopping_list:write"],
        notes: [
          "Dynamic client registration is public and returns token_endpoint_auth_method: none.",
          "Redirect URIs must be HTTPS; HTTP is accepted only for localhost and 127.0.0.1.",
          "PKCE is required: use a 43-128 character code_verifier and S256 code_challenge.",
          "Authorization codes are single-use and expire after 60 seconds.",
          `Access tokens are sj_... bearer credentials with a ${OAUTH_ACCESS_TOKEN_TTL_SECONDS}-second lifetime.`,
          "Refresh tokens are ort_... values and rotate on every refresh grant; POST /oauth/revoke disconnects a stored refresh token and revokes live OAuth access credentials for that client/resource.",
          "Registration validates optional scope metadata but does not grant it; the authorize request scope is the grant. Blank authorize scope defaults to kitchen:read, but apps should send explicit least-privilege scopes.",
          "OAuth scopes never grant tokens:read or tokens:write; personal token management uses /api/v1/tokens.",
          "grant_type=password is never supported.",
          "Most OAuth errors use standard OAuth JSON. Rate-limit responses are Spoonjoy's generic rate-limit shape with Retry-After.",
        ],
        sample: [
          "curl -sS 'https://spoonjoy.app/oauth/register' \\",
          "  -H 'Content-Type: application/json' \\",
          "  --data '{\"client_name\":\"Example grocery app\",\"redirect_uris\":[\"https://example.com/oauth/callback\"],\"token_endpoint_auth_method\":\"none\"}'",
          "",
          "# Open this URL in the browser after generating a PKCE S256 challenge.",
          "open 'https://spoonjoy.app/oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256'",
          "",
          "curl -sS 'https://spoonjoy.app/oauth/token' \\",
          "  -H 'Content-Type: application/x-www-form-urlencoded' \\",
          "  --data 'grant_type=authorization_code&client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&code=oac_...&code_verifier=pkce_verifier_0123456789_abcdefghijklmnopqrstuvwxyz_ABCDEF'",
          "",
          "curl -sS -X POST 'https://spoonjoy.app/oauth/revoke' \\",
          "  -H 'Content-Type: application/x-www-form-urlencoded' \\",
          "  --data 'token=ort_...&client_id=cm_client_id_from_register&token_type_hint=refresh_token'",
        ].join("\n"),
      },
      {
        id: "delegated-approval",
        title: "Delegated approval link",
        eyebrow: "Agent, appliance, no callback",
        audience: "Use for agents, CLIs, kitchen displays, and constrained devices that can show a chef an approval URL but cannot run an OAuth callback.",
        endpoints: ["/api/tools/start_agent_connection", "/api/tools/poll_agent_connection", "/api/v1/tokens/{credentialId}"],
        scopes: ["kitchen:read", "kitchen:write", "shopping_list:read", "shopping_list:write"],
        notes: [
          "The device code expires after 10 minutes.",
          "Poll no faster than the returned interval, currently 2 seconds.",
          "A pending poll returns pending plus authorizationUrl, verificationUri, verificationUriComplete, and userCode.",
          "Pass scopes such as shopping_list:read shopping_list:write to request a least-privilege delegated token; omitted scopes default to shopping_list:read shopping_list:write.",
          "Tiny devices can show verificationUri plus userCode instead of the long authorizationUrl.",
          "An approved poll returns the sj_... token once, plus token metadata.",
          "The token is a normal bearer credential. A device can revoke its own credential id with DELETE /api/v1/tokens/{credentialId}; revoking any other credential requires tokens:write.",
        ],
        sample: [
          "SJ_BASE='https://spoonjoy.app'",
          "umask 077",
          "state_dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/spoonjoy.XXXXXX\")\"",
          "trap 'rm -rf \"$state_dir\"' EXIT",
          "",
          "curl -sS 'https://spoonjoy.app/api/tools/start_agent_connection' \\",
          "  -H 'Content-Type: application/json' \\",
          "  --data '{\"agentName\":\"Kitchen display\",\"scopes\":\"shopping_list:read shopping_list:write\"}' \\",
          "  > \"$state_dir/start.json\"",
          "",
          "echo \"Open $(jq -r '.data.verificationUri' \"$state_dir/start.json\") and enter $(jq -r '.data.userCode' \"$state_dir/start.json\")\"",
          "",
          "while :; do",
          "  curl -sS \"$SJ_BASE/api/tools/poll_agent_connection\" \\",
          "    -H 'Content-Type: application/json' \\",
          "    --data \"{\\\"deviceCode\\\":\\\"$(jq -r '.data.deviceCode' \"$state_dir/start.json\")\\\"}\" \\",
          "    > \"$state_dir/poll.json\"",
          "  status=$(jq -r '.data.status' \"$state_dir/poll.json\")",
          "  test \"$status\" = approved && break",
          "  test \"$status\" = pending || exit 1",
          "  sleep \"$(jq -r '.data.interval // 2' \"$state_dir/start.json\")\"",
          "done",
          "export SPOONJOY_TOKEN=\"$(jq -r '.data.token' \"$state_dir/poll.json\")\"",
        ].join("\n"),
      },
      {
        id: "mcp",
        title: "Remote MCP client",
        eyebrow: "Assistant runtime",
        audience: "Use for MCP-capable clients that discover OAuth metadata, get a bearer token, then call the remote Spoonjoy MCP endpoint.",
        endpoints: ["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"],
        scopes: ["kitchen:read", "kitchen:write"],
        notes: [
          "POST /mcp challenges unauthenticated callers with OAuth protected-resource metadata.",
          "MCP delegated scopes use kitchen:read and kitchen:write.",
          "Token-management tools require personal tokens:read or tokens:write scopes; OAuth kitchen scopes do not grant them.",
          "The approved bearer token must be sent as Authorization: Bearer sj_...",
        ],
        sample: [
          "curl -sS 'https://spoonjoy.app/mcp' \\",
          "  -H 'Authorization: Bearer sj_...' \\",
          "  -H 'Content-Type: application/json' \\",
          "  --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'",
        ].join("\n"),
      },
    ],
    "x-client-scenarios": [
      {
        id: "cloudflare-worker-sync",
        title: "Cloudflare Worker sync bridge",
        eyebrow: "Serverless",
        audience: "Use for scheduled or queued sync jobs that store OAuth tokens and cursors in Worker storage.",
        notes: [
          "Store access_token, rotating refresh_token, and sync cursor behind a Durable Object, queue-level serializer, or D1 row lock; KV alone is not a safe compare-and-set primitive for refresh-token rotation.",
          "Replace the stored refresh token atomically after every refresh before releasing the per-chef lock.",
          "Do not put authenticated bearer responses in caches.default. Cache only anonymous public recipe/cookbook JSON if your bridge needs it.",
          "Respect Retry-After on 429 and retry network, 429, and 5xx failures with the same clientMutationId for mutations.",
          "OAuth token endpoints are form-encoded and do not use bearer or session auth headers; API v1 calls use Authorization: Bearer sj_...",
        ],
        sample: [
          "export default {",
          "  async queue(batch, env) {",
          "    for (const message of batch.messages) {",
          "      const id = env.SPOONJOY_CHEF_SYNC.idFromName(message.body.chefId);",
          "      await env.SPOONJOY_CHEF_SYNC.get(id).fetch('https://sync/run', {",
          "        method: 'POST',",
          "        body: JSON.stringify(message.body),",
          "      });",
          "      message.ack();",
          "    }",
          "  }",
          "};",
          "",
          "export class SpoonjoyChefSync {",
          "  constructor(state, env) {",
          "    this.state = state;",
          "    this.env = env;",
          "  }",
          "",
          "  async fetch(request) {",
          "    const job = await request.json();",
          "    const state = await this.readState(job.chefId);",
          "    const next = await this.syncShoppingList(state);",
          "    await this.writeState(job.chefId, next);",
          "    return new Response('ok');",
          "  }",
          "",
          "  async readState(chefId) {",
          "    const state = await this.env.SPOONJOY_STATE.get(`chef:${chefId}`, 'json');",
          "  if (!state?.access_token || !state?.refresh_token) throw new Error('Reconnect Spoonjoy OAuth.');",
          "  return state;",
          "  }",
          "",
          "  async writeState(chefId, state) {",
          "    await this.env.SPOONJOY_STATE.put(`chef:${chefId}`, JSON.stringify(state));",
          "  }",
          "",
          "  async refresh(state) {",
          "    const res = await fetch('https://spoonjoy.app/oauth/token', {",
          "      method: 'POST',",
          "      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },",
          "      body: new URLSearchParams({",
          "        grant_type: 'refresh_token',",
          "        client_id: this.env.SPOONJOY_CLIENT_ID,",
          "        refresh_token: state.refresh_token,",
          "      }),",
          "    });",
          "    if (!res.ok) throw new Error(`Spoonjoy refresh failed: ${res.status}`);",
          "    const tokens = await res.json();",
          "    return { ...state, access_token: tokens.access_token, refresh_token: tokens.refresh_token };",
          "  }",
          "",
          "  async spoonjoyFetch(state, path, init = {}) {",
          "  const request = (tokenState) => fetch(`https://spoonjoy.app${path}`, {",
          "    ...init,",
          "    headers: { Authorization: `Bearer ${tokenState.access_token}`, ...(init.headers || {}) },",
          "  });",
          "  let res = await request(state);",
          "  if (res.status === 401) {",
          "    state = await this.refresh(state);",
          "    res = await request(state);",
          "  }",
          "  return { res, state };",
          "  }",
          "",
          "  async syncShoppingList(state) {",
          "  let nextCursor = state.cursor ?? '';",
          "  while (true) {",
          "    const cursor = nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : '';",
          "    const result = await this.spoonjoyFetch(state, `/api/v1/shopping-list/sync?limit=50${cursor}`);",
          "    state = result.state;",
          "    if (result.res.status === 429) throw new Error(`Retry after ${result.res.headers.get('Retry-After') ?? 'later'}`);",
          "    if (!result.res.ok) throw new Error(`Spoonjoy sync failed: ${result.res.status}`);",
          "    const body = await result.res.json();",
          "    if (body.ok !== true) throw new Error(body.error?.code ?? 'spoonjoy_error');",
          "    await this.applyItems(body.data.items);",
          "    nextCursor = body.data.nextCursor;",
          "    state = { ...state, cursor: nextCursor };",
          "    if (!body.data.hasMore) break;",
          "  }",
          "  return state;",
          "  }",
          "",
          "  async applyItems(items) {",
          "  console.log(`Apply ${items.length} Spoonjoy shopping-list changes before saving the cursor.`);",
          "  }",
          "}",
        ].join("\n"),
      },
      {
        id: "browser-extension-shopping-sync",
        title: "Browser extension ingredient sync",
        eyebrow: "Extension background",
        audience: "Use for extensions that turn scraped ingredient rows into shopping-list mutations without exposing tokens to content scripts.",
        notes: [
          "Recipe clipping can use POST /api/v1/recipes/import with kitchen:write; shopping-list ingredient sync can stay on shopping_list:read shopping_list:write.",
          "Run OAuth/PKCE in the extension background or service worker, store state and code_verifier until callback, and keep bearer tokens out of content scripts.",
          "Register the HTTPS callback produced by chrome.identity.getRedirectURL/launchWebAuthFlow exactly; custom extension schemes are rejected.",
          "Use shopping_list:read shopping_list:write for ingredient sync, then post one row at a time with deterministic clientMutationId values.",
          "Call /oauth/revoke on disconnect and clear extension storage after the refresh token is revoked.",
        ],
        sample: [
          "const item = { sourceRowId: 'row-42', name: 'Eggs', quantity: 12, unit: 'Each' };",
          "await fetch('https://spoonjoy.app/api/v1/shopping-list/items', {",
          "  method: 'POST',",
          "  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },",
          "  body: JSON.stringify({",
          "    clientMutationId: `extension:${await sha256(recipeUrl)}:${item.sourceRowId}:${await sha256(JSON.stringify(item))}`,",
          "    name: item.name,",
          "    quantity: item.quantity,",
          "    unit: item.unit,",
          "  }),",
          "});",
        ].join("\n"),
      },
      {
        id: "no-code-connector",
        title: "No-code connector",
        eyebrow: "Zapier / Make",
        audience: "Use the connector OpenAPI profile for actions and polling triggers that no-code importers can understand.",
        notes: [
          "Import /api/v1/openapi.connector.json instead of the full playground spec when your builder wants OAS 3.0 and REST-only operations.",
          "API v1 does not have webhooks, REST Hooks, SSE, or event subscriptions yet; expose polling triggers only.",
          "Shopping-list sync is the reliable polling trigger: poll /api/v1/shopping-list/sync?limit=50, emit rows in reverse updatedAt order for no-code platforms, then persist nextCursor after the platform accepts the bundle.",
          "Public recipe/cookbook lists are catalog search snapshots, not owner export feeds; they do not include private data or deletion tombstones.",
          "Use OAuth/PKCE for user connections and call /oauth/revoke on disconnect; refresh-token revoke also revokes live OAuth access credentials for that client/resource.",
        ],
        sample: [
          "Trigger: New, updated, or removed shopping-list item",
          "1. GET /api/v1/shopping-list/sync?limit=50 with Authorization: Bearer sj_...",
          "2. Sort returned items by updatedAt descending before handing them to Zapier/Make.",
          "3. Include deletedAt rows as removals or filtered tombstones, depending on the platform.",
          "4. Persist data.nextCursor only after the trigger run succeeds.",
        ].join("\n"),
      },
      {
        id: "public-data-export",
        title: "Public data export",
        eyebrow: "BI / reporting",
        audience: "Use for public catalog snapshots and analytics where anonymous public data is enough.",
        notes: [
          "Recipes and cookbooks are cursor-paginated by createdAt/id for deterministic catalog walks.",
          "They are not repeatable snapshot guarantees, incremental updatedAt exports, or deletion-tombstone feeds in v1.",
          "Anonymous public responses expose Cache-Control: public, max-age=60, stale-while-revalidate=300; the API does not provide ETag or Last-Modified yet.",
          "Follow nextCursor until hasMore is false, and restart a full snapshot when you need to catch edits or removals.",
          "Owner-scoped incremental data is currently limited to shopping-list sync.",
        ],
        sample: [
          "snapshot_resource() {",
          "  path=\"$1\"",
          "  array_key=\"$2\"",
          "  out=\"$3\"",
          "  cursor=''",
          "  : > \"$out\"",
          "  while true; do",
          "    url=\"https://spoonjoy.app/api/v1/$path?limit=50\"",
          "    test -n \"$cursor\" && url=\"$url&cursor=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' \"$cursor\")\"",
          "    curl -fsS \"$url\" | tee page.json",
          "    jq -c \".data.$array_key[]\" page.json >> \"$out\"",
          "    test \"$(jq -r '.data.hasMore' page.json)\" = true || break",
          "    cursor=\"$(jq -r '.data.nextCursor' page.json)\"",
          "  done",
          "}",
          "",
          "snapshot_resource recipes recipes recipes.ndjson",
          "snapshot_resource cookbooks cookbooks cookbooks.ndjson",
          "# Restart full crawls periodically to catch public edits or removals.",
        ].join("\n"),
      },
    ],
    "x-current-capabilities": {
      available: [
        "public recipe and cookbook reads",
        "Native app contract for current Spoonjoy parity REST rows",
        "owner-scoped shopping-list read/sync/write/add-from-recipe/clear",
        "recipe, cookbook, spoon, cover, step, ingredient, and import contract declarations",
        "account, kitchen, profile photo, notification preference, APNs device, connection, and private sync contract declarations",
        "private no-store authenticated responses for native offline cache clients",
        "session-created and bearer-created API tokens",
        "OAuth/PKCE delegated access",
        "delegated agent/device approval links",
        "remote MCP endpoint",
        "cursor-paginated public recipe and cookbook lists",
        "public chef profile, chef graph, and scoped search reads",
      ],
      notYetAvailable: [
        "Inventory or pantry stock APIs",
        "Meal plan or \"today's recipes\" APIs",
        "Full account export APIs",
        "Canonical unit registry or density-based ingredient conversion",
        "webhooks, REST Hooks, SSE, and event subscriptions",
        "Bulk shopping-list import or batch mutation endpoints",
      ],
    },
  };
}

type MutableOpenApiDocument = Record<string, any>;

const CONNECTOR_PATHS = new Set([
  "/api/v1/recipes",
  "/api/v1/recipes/{id}",
  "/api/v1/cookbooks",
  "/api/v1/cookbooks/{id}",
  "/api/v1/search",
  "/api/v1/shopping-list",
  "/api/v1/shopping-list/sync",
  "/api/v1/shopping-list/items",
  "/api/v1/shopping-list/items/{itemId}",
]);

const SDK_PATHS = new Set([
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
  "/api/tools/start_agent_connection",
  "/api/tools/poll_agent_connection",
  "/api/v1",
  "/api/v1/health",
  "/api/v1/recipes",
  "/api/v1/recipes/{id}",
  "/api/v1/cookbooks",
  "/api/v1/cookbooks/{id}",
  "/api/v1/users/{identifier}",
  "/api/v1/users/{identifier}/fellow-chefs",
  "/api/v1/users/{identifier}/kitchen-visitors",
  "/api/v1/search",
  "/api/v1/shopping-list",
  "/api/v1/shopping-list/sync",
  "/api/v1/shopping-list/items",
  "/api/v1/shopping-list/items/{itemId}",
  "/api/v1/tokens",
  "/api/v1/tokens/{credentialId}",
]);

function visitOpenApiNode(value: unknown, visitor: (node: Record<string, any>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitOpenApiNode(item, visitor);
    return;
  }
  const node = value as Record<string, any>;
  visitor(node);
  for (const child of Object.values(node)) visitOpenApiNode(child, visitor);
}

function collectSchemaRefs(value: unknown, refs = new Set<string>()): Set<string> {
  visitOpenApiNode(value, (node) => {
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/components/schemas/")) {
      refs.add(node.$ref.slice("#/components/schemas/".length));
    }
  });
  return refs;
}

function normalizeSchemaForOpenApi30(value: unknown) {
  visitOpenApiNode(value, (node) => {
    if (Object.prototype.hasOwnProperty.call(node, "const")) {
      node.enum = [node.const];
      delete node.const;
    }
    if (typeof node.exclusiveMinimum === "number") {
      node.minimum = node.exclusiveMinimum;
      node.exclusiveMinimum = true;
    }
    if (Array.isArray(node.oneOf) && node.oneOf.length === 2) {
      const nullIndex = node.oneOf.findIndex((item: unknown) => (
        Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "null"
      ));
      /* istanbul ignore else -- @preserve current generated schemas only use nullable oneOf pairs that contain null. */
      if (nullIndex >= 0) {
        /* istanbul ignore next -- @preserve current connector nullable oneOf schemas put the null schema after the non-null schema. */
        const nonNull = node.oneOf[nullIndex === 0 ? 1 : 0];
        delete node.oneOf;
        /* istanbul ignore else -- @preserve current connector schemas express nullable refs; inline schemas are a defensive future fallback. */
        if (nonNull && typeof nonNull === "object" && "$ref" in nonNull) {
          node.allOf = [nonNull];
          node.nullable = true;
        } else {
          // Defensive conversion for future inline nullable oneOf schemas; current connector schemas use nullable refs or type arrays.
          /* istanbul ignore next -- @preserve defensive future inline nullable oneOf conversion */
          Object.assign(node, nonNull, { nullable: true });
        }
      }
    }
    if (Array.isArray(node.type) && node.type.includes("null")) {
      const nonNullTypes = node.type.filter((type: unknown) => type !== "null");
      node.nullable = true;
      /* istanbul ignore next -- @preserve current generated nullable type arrays collapse to one non-null type. */
      node.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
    }
  });
}

function stripCookieAuthFromConnectorPaths(paths: MutableOpenApiDocument) {
  visitOpenApiNode(paths, (node) => {
    if (!Array.isArray(node.security)) return;
    node.security = node.security.filter((entry: unknown) => (
      !entry || typeof entry !== "object" || !Object.prototype.hasOwnProperty.call(entry, "cookieAuth")
    ));
  });
}

function stripCredentialMode(paths: MutableOpenApiDocument, mode: string) {
  visitOpenApiNode(paths, (node) => {
    if (Array.isArray(node["x-credential-modes"])) {
      node["x-credential-modes"] = node["x-credential-modes"].filter((entry: unknown) => entry !== mode);
    }
  });
}

function preferOAuthForConnectorPaths(paths: MutableOpenApiDocument) {
  visitOpenApiNode(paths, (node) => {
    if (!Array.isArray(node.security)) return;
    const oauth = node.security.filter((entry: unknown) => (
      entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "oauth2")
    ));
    const anonymous = node.security.filter((entry: unknown) => (
      entry && typeof entry === "object" && Object.keys(entry as Record<string, unknown>).length === 0
    ));
    const bearer = node.security.filter((entry: unknown) => (
      entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "bearerAuth")
    ));
    node.security = [...anonymous, ...oauth, ...bearer];
  });
}

function annotateConnectorOperations(paths: MutableOpenApiDocument) {
  const annotations: Record<string, Record<string, Record<string, unknown>>> = {
    "/api/v1/recipes": {
      get: {
        "x-connector-role": "search",
        "x-display-name": "Search public recipes",
        "x-item-path": "$.data.recipes",
        "x-cursor-path": "$.data.nextCursor",
      },
    },
    "/api/v1/cookbooks": {
      get: {
        "x-connector-role": "search",
        "x-display-name": "Search public cookbooks",
        "x-item-path": "$.data.cookbooks",
        "x-cursor-path": "$.data.nextCursor",
      },
    },
    "/api/v1/search": {
      get: {
        "x-connector-role": "search",
        "x-display-name": "Search Spoonjoy",
        "x-item-path": "$.data.results",
      },
    },
    "/api/v1/shopping-list/sync": {
      get: {
        "x-connector-role": "pollingTrigger",
        "x-display-name": "New, updated, or removed shopping-list item",
        "x-item-path": "$.data.items",
        "x-cursor-path": "$.data.nextCursor",
        "x-dedupe-id": "id:updatedAt",
        "x-dedupe-fields": ["id", "updatedAt"],
        "x-updated-at": "updatedAt",
        "x-tombstone-field": "deletedAt",
        "x-removal-when": "deletedAt is not null",
      },
    },
    "/api/v1/shopping-list/items": {
      post: {
        "x-connector-role": "action",
        "x-display-name": "Add shopping-list item",
      },
    },
    "/api/v1/shopping-list/items/{itemId}": {
      patch: {
        "x-connector-role": "action",
        "x-display-name": "Set shopping-list item checked",
      },
      delete: {
        "x-connector-role": "action",
        "x-display-name": "Remove shopping-list item",
      },
    },
  };
  for (const [path, methods] of Object.entries(annotations)) {
    for (const [method, annotation] of Object.entries(methods)) {
      Object.assign(paths[path][method], annotation);
    }
  }
}

function stripCookieAuth(document: MutableOpenApiDocument) {
  delete document.components?.securitySchemes?.cookieAuth;
  stripCookieAuthFromConnectorPaths(document.paths);
  stripCredentialMode(document.paths, "session");
}

function sdkSchemasFor(document: MutableOpenApiDocument, paths: MutableOpenApiDocument) {
  return connectorSchemasFor(document, paths);
}

function connectorSchemasFor(document: MutableOpenApiDocument, paths: MutableOpenApiDocument) {
  const sourceSchemas = document.components.schemas;
  const needed = collectSchemaRefs(paths);
  const included = new Set<string>();
  const result: Record<string, unknown> = {};

  for (const name of needed) {
    const queue = [name];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (included.has(current) || !sourceSchemas[current]) continue;
      included.add(current);
      result[current] = sourceSchemas[current];
      for (const refName of collectSchemaRefs(sourceSchemas[current])) {
        queue.push(refName);
      }
    }
  }

  return result;
}

export function buildApiV1ConnectorOpenApiDocument(options: BuildOpenApiOptions = {}) {
  const full = JSON.parse(JSON.stringify(buildApiV1OpenApiDocument(options))) as MutableOpenApiDocument;
  const serverUrl = full.servers[0].url;
  const paths = Object.fromEntries(
    Object.entries(full.paths).filter(([path]) => CONNECTOR_PATHS.has(path)),
  );
  stripCookieAuthFromConnectorPaths(paths);
  stripCredentialMode(paths, "session");
  preferOAuthForConnectorPaths(paths);
  annotateConnectorOperations(paths);
  const schemas = connectorSchemasFor(full, paths);
  const document: MutableOpenApiDocument = {
    openapi: "3.0.3",
    info: {
      title: "Spoonjoy API v1 Connector Profile",
      version: full.info.version,
      description: "REST-only Spoonjoy API profile for no-code connector imports. OAuth authorize, MCP JSON-RPC, and delegated approval helper operations are intentionally omitted.",
    },
    servers: full.servers,
    security: [],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: full.components.securitySchemes.bearerAuth,
        oauth2: full.components.securitySchemes.oauth2,
      },
      schemas,
    },
    "x-connector-profile": {
      source: "/api/v1/openapi.json",
      docsUrl: absoluteApiUrl(serverUrl, "/api"),
      playgroundUrl: absoluteApiUrl(serverUrl, "/api/playground"),
      oauth: {
        registrationUrl: absoluteApiUrl(serverUrl, "/oauth/register"),
        authorizationUrl: absoluteApiUrl(serverUrl, "/oauth/authorize"),
        tokenUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
        revokeUrl: absoluteApiUrl(serverUrl, "/oauth/revoke"),
        refreshUrl: absoluteApiUrl(serverUrl, "/oauth/token"),
        pkce: true,
        tokenEndpointAuthMethod: "none",
        "x-pkce": true,
        "x-token-endpoint-auth-method": "none",
      },
      triggers: [
        {
          id: "shopping-list-sync",
          path: "/api/v1/shopping-list/sync",
          polling: true,
          eventName: "new_updated_or_removed_shopping_list_item",
          tombstoneField: "deletedAt",
          removalWhen: "deletedAt is not null",
          sortForNoCode: "Return rows to Zapier/Make newest-first by updatedAt after receiving Spoonjoy's cursor-ordered response.",
          cursorRule: "Persist data.nextCursor only after the trigger run succeeds.",
        },
      ],
      unavailable: [
        "webhooks, REST Hooks, SSE, and event subscriptions",
        "recipe/cookbook updatedAt export feeds and deletion tombstones",
        "no-code recipe write/import/export actions",
      ],
    },
  };
  normalizeSchemaForOpenApi30(document);
  return document;
}

export function buildApiV1SdkOpenApiDocument(options: BuildOpenApiOptions = {}) {
  const full = JSON.parse(JSON.stringify(buildApiV1OpenApiDocument(options))) as MutableOpenApiDocument;
  const serverUrl = full.servers[0].url;
  const paths = Object.fromEntries(
    Object.entries(full.paths).filter(([path]) => SDK_PATHS.has(path)),
  );
  full.paths = paths;
  stripCookieAuth(full);
  full.info = {
    title: "Spoonjoy API v1 SDK Profile",
    version: full.info.version,
    description: "Generated-SDK profile for Spoonjoy REST v1 resources, OAuth/PKCE URL construction and token exchange, delegated approval bootstrap helpers, and bearer-token lifecycle operations. MCP JSON-RPC, connector-only annotations, same-origin cookie auth, and raw spec endpoints are intentionally omitted.",
  };
  full.paths = paths;
  full.components.schemas = sdkSchemasFor(full, paths);
  full.components.schemas.SdkOpenApiDocument = schemas.SdkOpenApiDocument;
  full["x-sdk-profile"] = {
    source: "/api/v1/openapi.json",
    docsUrl: absoluteApiUrl(serverUrl, "/api"),
    playgroundUrl: absoluteApiUrl(serverUrl, "/api/playground"),
    auth: "Use bearerAuth for API v1 calls. OAuth register/authorize/token/revoke are included for PKCE linking; delegated approval helpers are included for CLIs and no-callback devices; same-origin session cookies are intentionally omitted from this profile.",
    omitted: [
      "MCP JSON-RPC endpoint",
      "raw OpenAPI document endpoints",
      "same-origin cookieAuth",
    ],
  };
  delete full["x-auth-flows"];
  delete full["x-client-scenarios"];
  delete full["x-current-capabilities"];
  delete full["x-oauth-scope-map"];
  return full;
}
