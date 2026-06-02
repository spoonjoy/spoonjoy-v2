import { API_V1_ERROR_STATUS, API_V1_RESOURCES } from "~/lib/api-v1-contract.server";

type JsonSchema = Record<string, unknown>;
type HttpMethod = typeof API_V1_RESOURCES[number]["methods"][number];
type ResourcePath = typeof API_V1_RESOURCES[number]["path"];

const jsonContent = (schema: JsonSchema, example: unknown) => ({
  "application/json": {
    schema,
    examples: {
      example: { value: example },
    },
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
  ChefSummary: objectSchema(["id", "username"], {
    id: idSchema,
    username: { type: "string", minLength: 1 },
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
    principal: { oneOf: [ref("ChefSummary"), { type: "null" }] },
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

const operationMeta: Record<ResourcePath, Partial<Record<HttpMethod, {
  operationId: string;
  tags: string[];
  summary: string;
  success: Record<number, string>;
  errors: number[];
  parameters?: unknown[];
  requestBody?: string;
}>>> = {
  "/api/v1": {
    GET: { operationId: "getApiV1Root", tags: ["Discovery"], summary: "Discover the Spoonjoy API", success: { 200: "DiscoveryEnvelope" }, errors: [401, 429, 500] },
  },
  "/api/v1/health": {
    GET: { operationId: "getApiV1Health", tags: ["Discovery"], summary: "Check API health", success: { 200: "HealthEnvelope" }, errors: [401, 429, 500] },
  },
  "/api/v1/openapi.json": {
    GET: { operationId: "getApiV1OpenApi", tags: ["Discovery"], summary: "Fetch the OpenAPI document", success: { 200: "SuccessEnvelope" }, errors: [401, 429, 500] },
  },
  "/api/v1/recipes": {
    GET: { operationId: "getApiV1Recipes", tags: ["Recipes"], summary: "Search public recipes", success: { 200: "RecipeListEnvelope" }, errors: [400, 401, 403, 429, 500], parameters: [queryParameters.query, queryParameters.q, queryParameters.limit] },
  },
  "/api/v1/recipes/{id}": {
    GET: { operationId: "getApiV1Recipe", tags: ["Recipes"], summary: "Read one public recipe", success: { 200: "RecipeDetailEnvelope" }, errors: [401, 403, 404, 429, 500], parameters: [pathParameters.id] },
  },
  "/api/v1/cookbooks": {
    GET: { operationId: "getApiV1Cookbooks", tags: ["Cookbooks"], summary: "Search public cookbooks", success: { 200: "CookbookListEnvelope" }, errors: [400, 401, 403, 429, 500], parameters: [queryParameters.query, queryParameters.q, queryParameters.limit] },
  },
  "/api/v1/cookbooks/{id}": {
    GET: { operationId: "getApiV1Cookbook", tags: ["Cookbooks"], summary: "Read one public cookbook", success: { 200: "CookbookDetailEnvelope" }, errors: [401, 403, 404, 429, 500], parameters: [pathParameters.id] },
  },
  "/api/v1/shopping-list": {
    GET: { operationId: "getApiV1ShoppingList", tags: ["Shopping List"], summary: "Read the authenticated shopping list", success: { 200: "ShoppingListEnvelope" }, errors: [401, 403, 429, 500] },
  },
  "/api/v1/shopping-list/sync": {
    GET: { operationId: "getApiV1ShoppingListSync", tags: ["Shopping List"], summary: "Sync shopping-list changes", success: { 200: "ShoppingListSyncEnvelope" }, errors: [400, 401, 403, 429, 500], parameters: [queryParameters.cursor] },
  },
  "/api/v1/shopping-list/items": {
    POST: { operationId: "postApiV1ShoppingListItems", tags: ["Shopping List"], summary: "Add or restore a shopping-list item", success: { 200: "CreateShoppingItemEnvelope", 201: "CreateShoppingItemEnvelope" }, errors: [400, 401, 403, 409, 429, 500], requestBody: "CreateShoppingItemRequest" },
  },
  "/api/v1/shopping-list/items/{itemId}": {
    PATCH: { operationId: "patchApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Set a shopping-list item checked state", success: { 200: "UpdateShoppingItemEnvelope" }, errors: [400, 401, 403, 404, 409, 429, 500], parameters: [pathParameters.itemId], requestBody: "CheckShoppingItemRequest" },
    DELETE: { operationId: "deleteApiV1ShoppingListItem", tags: ["Shopping List"], summary: "Remove a shopping-list item", success: { 200: "DeleteShoppingItemEnvelope" }, errors: [400, 401, 403, 404, 409, 429, 500], parameters: [pathParameters.itemId], requestBody: "DeleteShoppingItemRequest" },
  },
  "/api/v1/tokens": {
    GET: { operationId: "getApiV1Tokens", tags: ["Tokens"], summary: "List personal API tokens", success: { 200: "TokenListEnvelope" }, errors: [401, 403, 429, 500] },
    POST: { operationId: "postApiV1Tokens", tags: ["Tokens"], summary: "Create a personal API token", success: { 201: "CreateTokenEnvelope" }, errors: [400, 401, 403, 429, 500], requestBody: "CreateTokenRequest" },
  },
  "/api/v1/tokens/{credentialId}": {
    DELETE: { operationId: "deleteApiV1Token", tags: ["Tokens"], summary: "Revoke a personal API token", success: { 200: "RevokeTokenEnvelope" }, errors: [401, 403, 404, 429, 500], parameters: [pathParameters.credentialId] },
  },
};

function response(status: number, schemaName: string) {
  return {
    description: status >= 200 && status < 300 ? "Success" : "Error",
    content: jsonContent(ref(schemaName), status >= 200 && status < 300
      ? { ok: true, requestId: "req_example", data: {} }
      : { ok: false, requestId: "req_example", error: { code: "validation_error", message: "Validation failed", status } }),
  };
}

function resourceFor(path: ResourcePath, method: HttpMethod) {
  return API_V1_RESOURCES.find((resource) => (
    resource.path === path && (resource.methods as readonly string[]).includes(method)
  ));
}

export function buildApiV1OpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const path of Object.keys(operationMeta) as ResourcePath[]) {
    paths[path] = {};
    for (const method of Object.keys(operationMeta[path]) as HttpMethod[]) {
      const meta = operationMeta[path][method];
      const resource = resourceFor(path, method);
      if (!meta || !resource) continue;
      const responses: Record<string, unknown> = {};
      for (const [status, schemaName] of Object.entries(meta.success)) {
        responses[status] = response(Number(status), schemaName);
      }
      for (const status of meta.errors) {
        responses[status] = response(status, "ErrorEnvelope");
      }

      paths[path][method.toLowerCase()] = {
        operationId: meta.operationId,
        tags: meta.tags,
        summary: meta.summary,
        "x-auth": resource.auth,
        "x-scopes": resource.scopes,
        ...(resource.auth === "bearer" ? { security: [{ bearerAuth: [] }] } : {}),
        ...(meta.parameters ? { parameters: meta.parameters } : {}),
        ...(meta.requestBody
          ? {
              requestBody: {
                required: true,
                content: jsonContent(ref(meta.requestBody), {}),
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
