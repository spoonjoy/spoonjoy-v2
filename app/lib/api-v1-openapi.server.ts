import {
  API_V1_ERROR_STATUS,
  API_V1_RESOURCES,
  API_V1_SCOPE_REQUIREMENTS,
  type ApiV1ErrorCode,
} from "~/lib/api-v1-contract.server";

type JsonSchema = Record<string, unknown>;
type HttpMethod = typeof API_V1_RESOURCES[number]["methods"][number];
type ResourcePath = typeof API_V1_RESOURCES[number]["path"];
type OperationAuth = "optional" | "bearer";

interface OperationConfig {
  operationId: string;
  tags: string[];
  summary: string;
  auth: OperationAuth;
  scopes: string[];
  success: Record<number, string>;
  errors: ApiV1ErrorCode[];
  parameters?: unknown[];
  requestBody?: string;
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

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const idSchema = { type: "string", minLength: 1 };
const dateTimeSchema = { type: "string", format: "date-time" };
const nullableDateTimeSchema = { type: ["string", "null"], format: "date-time" };
const nullableStringSchema = { type: ["string", "null"] };
const nullableNumberSchema = { type: ["number", "null"] };

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
    name: { type: "string" },
    quantity: { type: "number" },
    unit: nullableStringSchema,
  }),
  RecipeStep: objectSchema(["id", "stepNum", "stepTitle", "description", "duration", "ingredients"], {
    id: idSchema,
    stepNum: { type: "integer" },
    stepTitle: nullableStringSchema,
    description: { type: "string" },
    duration: { type: ["integer", "null"] },
    ingredients: arrayOf(ref("RecipeIngredient")),
  }),
  CookbookLink: objectSchema(["id", "title", "href"], {
    id: idSchema,
    title: { type: "string" },
    href: { type: "string" },
  }),
  RecipeSummary: objectSchema(["id", "title", "description", "servings", "chef", "href", "createdAt", "updatedAt"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    href: { type: "string" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  RecipeDetail: objectSchema(["id", "title", "description", "servings", "chef", "href", "createdAt", "updatedAt", "steps", "cookbooks"], {
    id: idSchema,
    title: { type: "string" },
    description: nullableStringSchema,
    servings: nullableStringSchema,
    chef: ref("ChefSummary"),
    href: { type: "string" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    steps: arrayOf(ref("RecipeStep")),
    cookbooks: arrayOf(ref("CookbookLink")),
  }),
  CookbookSummary: objectSchema(["id", "title", "chef", "recipeCount", "href", "createdAt", "updatedAt"], {
    id: idSchema,
    title: { type: "string" },
    chef: ref("ChefSummary"),
    recipeCount: { type: "integer" },
    href: { type: "string" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  CookbookDetail: objectSchema(["id", "title", "chef", "recipeCount", "href", "createdAt", "updatedAt", "recipes"], {
    id: idSchema,
    title: { type: "string" },
    chef: ref("ChefSummary"),
    recipeCount: { type: "integer" },
    href: { type: "string" },
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    recipes: arrayOf(ref("RecipeSummary")),
  }),
  CredentialMetadata: objectSchema(["id", "name", "tokenPrefix", "scopes", "createdAt", "updatedAt", "lastUsedAt", "revokedAt", "expiresAt"], {
    id: idSchema,
    name: { type: "string" },
    tokenPrefix: { type: "string" },
    scopes: arrayOf({ type: "string" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    lastUsedAt: nullableDateTimeSchema,
    revokedAt: nullableDateTimeSchema,
    expiresAt: nullableDateTimeSchema,
  }),
  ShoppingItem: objectSchema(["id", "name", "quantity", "unit", "checked", "checkedAt", "deletedAt", "categoryKey", "iconKey", "sortIndex", "updatedAt"], {
    id: idSchema,
    name: { type: "string" },
    quantity: nullableNumberSchema,
    unit: nullableStringSchema,
    checked: { type: "boolean" },
    checkedAt: nullableDateTimeSchema,
    deletedAt: nullableDateTimeSchema,
    categoryKey: nullableStringSchema,
    iconKey: nullableStringSchema,
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
    clientMutationId: { type: "string", minLength: 1 },
    replayed: { type: "boolean" },
  }),
  CreateTokenRequest: objectSchema(["name"], {
    name: { type: "string", minLength: 1 },
    scopes: {
      oneOf: [
        { type: "string" },
        arrayOf({ type: "string" }),
      ],
    },
  }),
  CreateShoppingItemRequest: objectSchema(["clientMutationId", "name"], {
    clientMutationId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    quantity: { type: "number", exclusiveMinimum: 0 },
    unit: nullableStringSchema,
    categoryKey: nullableStringSchema,
    iconKey: nullableStringSchema,
  }),
  CheckShoppingItemRequest: objectSchema(["clientMutationId", "checked"], {
    clientMutationId: { type: "string", minLength: 1 },
    checked: { type: "boolean" },
  }),
  DeleteShoppingItemRequest: objectSchema(["clientMutationId"], {
    clientMutationId: { type: "string", minLength: 1 },
  }),
  DiscoveryData: objectSchema(["app", "version", "status", "docsUrl", "openapiUrl", "resources", "auth"], {
    app: { const: "spoonjoy" },
    version: { const: "v1" },
    status: { const: "ok" },
    docsUrl: { type: "string" },
    openapiUrl: { type: "string" },
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
  RecipeListData: objectSchema(["query", "limit", "recipes"], {
    query: nullableStringSchema,
    limit: { type: "integer" },
    recipes: arrayOf(ref("RecipeSummary")),
  }),
  RecipeDetailData: objectSchema(["recipe"], { recipe: ref("RecipeDetail") }),
  CookbookListData: objectSchema(["query", "limit", "cookbooks"], {
    query: nullableStringSchema,
    limit: { type: "integer" },
    cookbooks: arrayOf(ref("CookbookSummary")),
  }),
  CookbookDetailData: objectSchema(["cookbook"], { cookbook: ref("CookbookDetail") }),
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
    nextCursor: dateTimeSchema,
  }),
  ShoppingListSyncData: objectSchema(["items", "nextCursor", "hasMore"], {
    items: arrayOf(ref("ShoppingItem")),
    nextCursor: dateTimeSchema,
    hasMore: { const: false },
  }),
  CreateShoppingItemData: objectSchema(["created", "updated", "item", "shoppingList", "mutation"], {
    created: { type: "boolean" },
    updated: { type: "boolean" },
    item: ref("ShoppingItem"),
    shoppingList: ref("ShoppingList"),
    mutation: ref("MutationMetadata"),
  }),
  UpdateShoppingItemData: objectSchema(["item", "shoppingList", "mutation"], {
    item: ref("ShoppingItem"),
    shoppingList: ref("ShoppingList"),
    mutation: ref("MutationMetadata"),
  }),
  DeleteShoppingItemData: objectSchema(["removed", "item", "shoppingList", "mutation"], {
    removed: { type: "boolean" },
    item: ref("ShoppingItem"),
    shoppingList: ref("ShoppingList"),
    mutation: ref("MutationMetadata"),
  }),
  DiscoveryEnvelope: successEnvelope(ref("DiscoveryData")),
  HealthEnvelope: successEnvelope(ref("HealthData")),
  RecipeListEnvelope: successEnvelope(ref("RecipeListData")),
  RecipeDetailEnvelope: successEnvelope(ref("RecipeDetailData")),
  CookbookListEnvelope: successEnvelope(ref("CookbookListData")),
  CookbookDetailEnvelope: successEnvelope(ref("CookbookDetailData")),
  TokenListEnvelope: successEnvelope(ref("TokenListData")),
  CreateTokenEnvelope: successEnvelope(ref("CreateTokenData")),
  RevokeTokenEnvelope: successEnvelope(ref("RevokeTokenData")),
  ShoppingListEnvelope: successEnvelope(ref("ShoppingListData")),
  ShoppingListSyncEnvelope: successEnvelope(ref("ShoppingListSyncData")),
  CreateShoppingItemEnvelope: successEnvelope(ref("CreateShoppingItemData")),
  UpdateShoppingItemEnvelope: successEnvelope(ref("UpdateShoppingItemData")),
  DeleteShoppingItemEnvelope: successEnvelope(ref("DeleteShoppingItemData")),
} satisfies Record<string, JsonSchema>;

const pathParameters = {
  id: { name: "id", in: "path", required: true, schema: idSchema },
  itemId: { name: "itemId", in: "path", required: true, schema: idSchema },
  credentialId: { name: "credentialId", in: "path", required: true, schema: idSchema },
};

const queryParameters = {
  query: { name: "query", in: "query", required: false, schema: { type: "string" } },
  q: { name: "q", in: "query", required: false, schema: { type: "string" } },
  cursor: { name: "cursor", in: "query", required: false, schema: { type: "string", format: "date-time" } },
  limit: { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
};

const operationMeta: Record<ResourcePath, Partial<Record<HttpMethod, OperationConfig>>> = {
  "/api/v1": {
    GET: { operationId: "getApiV1Root", tags: ["Discovery"], summary: "Discover the Spoonjoy API", auth: "optional", scopes: [], success: { 200: "DiscoveryEnvelope" }, errors: ["invalid_token", "method_not_allowed", "rate_limited", "internal_error"] },
  },
  "/api/v1/health": {
    GET: { operationId: "getApiV1Health", tags: ["Discovery"], summary: "Check API health", auth: "optional", scopes: [], success: { 200: "HealthEnvelope" }, errors: ["invalid_token", "method_not_allowed", "rate_limited", "internal_error"] },
  },
  "/api/v1/openapi.json": {
    GET: { operationId: "getApiV1OpenApi", tags: ["Discovery"], summary: "Fetch the OpenAPI document", auth: "optional", scopes: [], success: { 200: "OpenApiDocument" }, errors: ["invalid_token", "method_not_allowed", "rate_limited", "internal_error"] },
  },
  "/api/v1/recipes": {
    GET: { operationId: "getApiV1Recipes", tags: ["Recipes"], summary: "Search public recipes", auth: "optional", scopes: ["recipes:read"], success: { 200: "RecipeListEnvelope" }, errors: ["validation_error", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"], parameters: [queryParameters.query, queryParameters.q, queryParameters.limit] },
  },
  "/api/v1/recipes/{id}": {
    GET: { operationId: "getApiV1Recipe", tags: ["Recipes"], summary: "Read one public recipe", auth: "optional", scopes: ["recipes:read"], success: { 200: "RecipeDetailEnvelope" }, errors: ["invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.id] },
  },
  "/api/v1/cookbooks": {
    GET: { operationId: "getApiV1Cookbooks", tags: ["Cookbooks"], summary: "Search public cookbooks", auth: "optional", scopes: ["cookbooks:read"], success: { 200: "CookbookListEnvelope" }, errors: ["validation_error", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"], parameters: [queryParameters.query, queryParameters.q, queryParameters.limit] },
  },
  "/api/v1/cookbooks/{id}": {
    GET: { operationId: "getApiV1Cookbook", tags: ["Cookbooks"], summary: "Read one public cookbook", auth: "optional", scopes: ["cookbooks:read"], success: { 200: "CookbookDetailEnvelope" }, errors: ["invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.id] },
  },
  "/api/v1/shopping-list": {
    GET: { operationId: "getApiV1ShoppingList", tags: ["Shopping List"], summary: "Read the authenticated shopping list", auth: "bearer", scopes: ["shopping_list:read"], success: { 200: "ShoppingListEnvelope" }, errors: ["authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"] },
  },
  "/api/v1/shopping-list/sync": {
    GET: { operationId: "getApiV1ShoppingListSync", tags: ["Shopping List"], summary: "Sync shopping-list changes", auth: "bearer", scopes: ["shopping_list:read"], success: { 200: "ShoppingListSyncEnvelope" }, errors: ["invalid_cursor", "authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"], parameters: [queryParameters.cursor] },
  },
  "/api/v1/shopping-list/items": {
    POST: { operationId: "postApiV1ShoppingListItems", tags: ["Shopping List"], summary: "Add or restore a shopping-list item", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "CreateShoppingItemEnvelope", 201: "CreateShoppingItemEnvelope" }, errors: ["invalid_json", "validation_error", "authentication_required", "invalid_token", "insufficient_scope", "idempotency_conflict", "method_not_allowed", "rate_limited", "internal_error"], requestBody: "CreateShoppingItemRequest" },
  },
  "/api/v1/shopping-list/items/{itemId}": {
    PATCH: { operationId: "patchApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Set a shopping-list item checked state", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "UpdateShoppingItemEnvelope" }, errors: ["invalid_json", "validation_error", "authentication_required", "invalid_token", "insufficient_scope", "not_found", "idempotency_conflict", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.itemId], requestBody: "CheckShoppingItemRequest" },
    DELETE: { operationId: "deleteApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Remove a shopping-list item", auth: "bearer", scopes: ["shopping_list:write"], success: { 200: "DeleteShoppingItemEnvelope" }, errors: ["invalid_json", "validation_error", "authentication_required", "invalid_token", "insufficient_scope", "not_found", "idempotency_conflict", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.itemId], requestBody: "DeleteShoppingItemRequest" },
  },
  "/api/v1/tokens": {
    GET: { operationId: "getApiV1Tokens", tags: ["Tokens"], summary: "List personal API tokens", auth: "bearer", scopes: ["tokens:read"], success: { 200: "TokenListEnvelope" }, errors: ["authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"] },
    POST: { operationId: "postApiV1Tokens", tags: ["Tokens"], summary: "Create a personal API token", auth: "bearer", scopes: ["tokens:write"], success: { 201: "CreateTokenEnvelope" }, errors: ["invalid_json", "validation_error", "invalid_scope", "authentication_required", "invalid_token", "insufficient_scope", "method_not_allowed", "rate_limited", "internal_error"], requestBody: "CreateTokenRequest" },
  },
  "/api/v1/tokens/{credentialId}": {
    DELETE: { operationId: "deleteApiV1Token", tags: ["Tokens"], summary: "Revoke a personal API token", auth: "bearer", scopes: ["tokens:write"], success: { 200: "RevokeTokenEnvelope" }, errors: ["authentication_required", "invalid_token", "insufficient_scope", "not_found", "method_not_allowed", "rate_limited", "internal_error"], parameters: [pathParameters.credentialId] },
  },
};

const exampleTimestamp = "2026-06-01T00:00:00.000Z";
const exampleChef = { id: "chef_1", username: "ari" };
const examplePrincipal = { ...exampleChef, source: "bearer" };
const exampleRecipeIngredient = { id: "ingredient_1", name: "pasta", quantity: 1, unit: "lb" };
const exampleRecipeStep = {
  id: "step_1",
  stepNum: 1,
  stepTitle: null,
  description: "Boil pasta.",
  duration: null,
  ingredients: [exampleRecipeIngredient],
};
const exampleCookbookLink = { id: "cookbook_1", title: "Weeknights", href: "/cookbooks/cookbook_1" };
const exampleRecipeSummary = {
  id: "recipe_1",
  title: "Pasta",
  description: "Weeknight pasta",
  servings: "4",
  chef: exampleChef,
  href: "/recipes/recipe_1",
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleRecipeDetail = {
  ...exampleRecipeSummary,
  steps: [exampleRecipeStep],
  cookbooks: [exampleCookbookLink],
};
const exampleCookbookSummary = {
  id: "cookbook_1",
  title: "Weeknights",
  chef: exampleChef,
  recipeCount: 1,
  href: "/cookbooks/cookbook_1",
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
};
const exampleCookbookDetail = { ...exampleCookbookSummary, recipes: [exampleRecipeSummary] };
const exampleCredential = {
  id: "cred_1",
  name: "Tiny client",
  tokenPrefix: "sj_abc123456",
  scopes: ["recipes:read"],
  createdAt: exampleTimestamp,
  updatedAt: exampleTimestamp,
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
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
const exampleShoppingList = {
  id: "list_1",
  chef: exampleChef,
  items: [exampleShoppingItem],
  updatedAt: exampleTimestamp,
};
const exampleMutation = { clientMutationId: "device-uuid-1", replayed: false };

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
  DiscoveryEnvelope: {
    ok: true,
    requestId: "req_example",
    data: {
      app: "spoonjoy",
      version: "v1",
      status: "ok",
      docsUrl: "https://spoonjoy.app/developers",
      openapiUrl: "/api/v1/openapi.json",
      resources: API_V1_RESOURCES,
      auth: { type: "bearer", tokenUrl: "/api/v1/tokens" },
    },
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
  RecipeListEnvelope: { ok: true, requestId: "req_example", data: { query: "pasta", limit: 20, recipes: [exampleRecipeSummary] } },
  RecipeDetailEnvelope: { ok: true, requestId: "req_example", data: { recipe: exampleRecipeDetail } },
  CookbookListEnvelope: { ok: true, requestId: "req_example", data: { query: "weeknight", limit: 20, cookbooks: [exampleCookbookSummary] } },
  CookbookDetailEnvelope: { ok: true, requestId: "req_example", data: { cookbook: exampleCookbookDetail } },
  TokenListEnvelope: { ok: true, requestId: "req_example", data: { tokens: [exampleCredential] } },
  CreateTokenEnvelope: { ok: true, requestId: "req_example", data: { token: "sj_secret", credential: exampleCredential } },
  RevokeTokenEnvelope: { ok: true, requestId: "req_example", data: { revoked: true, credential: { ...exampleCredential, revokedAt: exampleTimestamp } } },
  ShoppingListEnvelope: { ok: true, requestId: "req_example", data: { shoppingList: exampleShoppingList, nextCursor: exampleTimestamp } },
  ShoppingListSyncEnvelope: { ok: true, requestId: "req_example", data: { items: [exampleShoppingItem], nextCursor: exampleTimestamp, hasMore: false } },
  CreateShoppingItemEnvelope: {
    ok: true,
    requestId: "req_example",
    data: { created: true, updated: false, item: exampleShoppingItem, shoppingList: exampleShoppingList, mutation: exampleMutation },
  },
  UpdateShoppingItemEnvelope: { ok: true, requestId: "req_example", data: { item: { ...exampleShoppingItem, checked: true, checkedAt: exampleTimestamp }, shoppingList: exampleShoppingList, mutation: exampleMutation } },
  DeleteShoppingItemEnvelope: { ok: true, requestId: "req_example", data: { removed: true, item: { ...exampleShoppingItem, deletedAt: exampleTimestamp }, shoppingList: exampleShoppingList, mutation: exampleMutation } },
};

const requestExamples: Record<string, unknown> = {
  CreateTokenRequest: { name: "Tiny client", scopes: ["recipes:read", "shopping_list:read"] },
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
};

const errorMessages: Record<ApiV1ErrorCode, string> = {
  invalid_json: "Invalid JSON body",
  validation_error: "limit must be an integer between 1 and 50",
  invalid_cursor: "cursor must be a valid ISO date-time",
  invalid_scope: "Unknown API credential scope: recipes:delete",
  authentication_required: "Authentication required",
  invalid_token: "Invalid API token",
  insufficient_scope: "Missing required scope: tokens:read",
  not_found: "Resource not found",
  method_not_allowed: "Method not allowed",
  idempotency_conflict: "Idempotency key was already used for a different request",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
};

function successResponse(schemaName: string) {
  return {
    description: "Success",
    content: jsonContent(ref(schemaName), responseExamples[schemaName]),
  };
}

function errorResponse(codes: ApiV1ErrorCode[]) {
  return {
    description: "Error",
    content: jsonContentExamples(
      ref("ErrorEnvelope"),
      Object.fromEntries(codes.map((code) => [
        code,
        {
          ok: false,
          requestId: "req_example",
          error: { code, message: errorMessages[code], status: API_V1_ERROR_STATUS[code] },
        },
      ])),
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

export function buildApiV1OpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const path of Object.keys(operationMeta) as ResourcePath[]) {
    paths[path] = {};
    for (const method of Object.keys(operationMeta[path]) as HttpMethod[]) {
      const meta = operationMeta[path][method]!;
      const requirement = scopeRequirementForOperation(path, method);
      const responses: Record<string, unknown> = {};
      for (const [status, schemaName] of Object.entries(meta.success)) {
        responses[status] = successResponse(schemaName);
      }
      for (const [status, codes] of errorCodesByStatus(meta.errors)) {
        responses[String(status)] = errorResponse(codes);
      }

      paths[path][method.toLowerCase()] = {
        operationId: meta.operationId,
        tags: meta.tags,
        summary: meta.summary,
        "x-auth": requirement.auth,
        "x-scopes": [...requirement.scopes],
        ...(requirement.auth === "bearer" ? { security: [{ bearerAuth: [...requirement.scopes] }] } : {}),
        ...(meta.parameters ? { parameters: meta.parameters } : {}),
        ...(meta.requestBody
          ? {
              requestBody: {
                required: true,
                content: jsonContent(ref(meta.requestBody), requestExamples[meta.requestBody]),
              },
            }
          : {}),
        responses,
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Spoonjoy API",
      version: "v1",
      description: "Spoonjoy's public-by-default Chef graph plus authenticated token and shopping-list APIs.",
    },
    servers: [{ url: "https://spoonjoy.app" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Spoonjoy API token",
        },
      },
      schemas,
    },
  };
}
