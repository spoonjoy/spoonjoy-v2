import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildApiV1ConnectorOpenApiDocument,
  buildApiV1OpenApiDocument,
  buildApiV1SdkOpenApiDocument,
} from "../app/lib/api-v1-openapi.server";

type OpenApiDocument = ReturnType<typeof buildApiV1OpenApiDocument>;
type ApiPlaygroundProfile = "full" | "connector" | "sdk";
type ApiPlaygroundAuthFlow = {
  id: string;
  title: string;
  eyebrow: string;
  audience: string;
  endpoints: string[];
  scopes: string[];
  notes: string[];
  sample: string;
};
type ApiPlaygroundCapabilities = {
  available: string[];
  notYetAvailable: string[];
};
type ApiPlaygroundClientScenario = {
  id: string;
  title: string;
  eyebrow: string;
  audience: string;
  notes: string[];
  sample: string;
};
type OpenApiOperation = {
  operationId?: string;
  tags?: string[];
  summary?: string;
  "x-auth"?: "optional" | "bearer";
  "x-scopes"?: string[];
  "x-grantable-scopes"?: string[];
  "x-accepted-oauth-scopes"?: string[][];
  "x-credential-modes"?: Array<"anonymous" | "session" | "bearer" | "oauth_pkce">;
  "x-retry-policy"?: Record<string, unknown>;
  "x-cursor-policy"?: Record<string, unknown>;
  "x-idempotency"?: Record<string, unknown>;
  "x-personal-token-only"?: boolean;
  "x-oauth-note"?: string;
  "x-self-revoke-exception"?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: {
      "application/json"?: {
        examples?: Record<string, { value?: unknown }>;
      };
      "application/x-www-form-urlencoded"?: {
        examples?: Record<string, { value?: unknown }>;
      };
    };
  };
  responses?: Record<string, OpenApiResponse>;
};
type OpenApiResponse = {
  description?: string;
  content?: {
    "application/json"?: {
      example?: unknown;
      examples?: Record<string, { value?: unknown }>;
    };
  };
};
type OpenApiParameter = {
  name?: string;
  in?: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema?: {
    type?: string;
    format?: string;
    default?: unknown;
    minimum?: number;
    maximum?: number;
  };
};

const OUTPUT_FILE = "app/lib/generated/api-v1-playground.ts";
export const OPENAPI_OPERATION_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const OPENAPI_OPERATION_METHOD_SET = new Set<string>(OPENAPI_OPERATION_METHODS);

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function defaultPathValue(path: string, name: string) {
  if (name === "itemId") return "item_1";
  if (name === "credentialId") return "cred_1";
  if (name === "id" && path.includes("/recipes/")) return "recipe_1";
  if (name === "id" && path.includes("/cookbooks/")) return "cookbook_1";
  return "";
}

function placeholderFor(path: string, parameter: OpenApiParameter) {
  const name = parameter.name ?? "";
  if (parameter.in === "path") return defaultPathValue(path, name) || name;
  if (name === "query") return "pasta";
  if (name === "q") return "weeknight";
  if (name === "cursor" && path.includes("/shopping-list/sync")) return "v1.cursor_or_iso_bootstrap";
  if (name === "cursor") return "v1.cursor_from_nextCursor";
  if (name === "limit") return "20";
  if (name === "X-Client-Mutation-Id") return "delete:item_1:uuid-or-hash";
  if (name === "state") return "generated_random_state";
  return name;
}

function defaultQueryValue(parameter: OpenApiParameter) {
  if (parameter.name === "state") return "";
  const defaultValue = parameter.schema?.default;
  return defaultValue === undefined ? "" : String(defaultValue);
}

function parameterFromOpenApi(path: string, parameter: OpenApiParameter) {
  const name = parameter.name ?? "";
  const location = parameter.in ?? "query";
  return {
    name,
    in: location,
    label: titleCase(name),
    required: Boolean(parameter.required),
    defaultValue: location === "path" ? "" : defaultQueryValue(parameter),
    placeholder: placeholderFor(path, parameter),
    description: parameter.description ?? "",
    schema: {
      type: parameter.schema?.type ?? "string",
      ...(parameter.schema?.format ? { format: parameter.schema.format } : {}),
      ...(parameter.schema?.minimum !== undefined ? { minimum: parameter.schema.minimum } : {}),
      ...(parameter.schema?.maximum !== undefined ? { maximum: parameter.schema.maximum } : {}),
    },
  };
}

function requestBodyExample(operation: OpenApiOperation) {
  const jsonExamples = operation.requestBody?.content?.["application/json"]?.examples;
  const formExamples = operation.requestBody?.content?.["application/x-www-form-urlencoded"]?.examples;
  const examples = jsonExamples ?? formExamples;
  const example = examples?.example?.value ?? Object.values(examples ?? {})[0]?.value;
  if (example === undefined) return null;
  const contentType = jsonExamples ? "application/json" : "application/x-www-form-urlencoded";
  const renderExample = (value: unknown) => typeof value === "string"
    ? value
    : contentType === "application/json"
      ? JSON.stringify(value, null, 2)
      : new URLSearchParams(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)])).toString();
  const renderedExample = renderExample(example);
  return {
    required: Boolean(operation.requestBody?.required),
    contentType,
    example: renderedExample,
    examples: Object.entries(examples ?? {}).map(([name, item]) => ({
      name,
      label: titleCase(name),
      example: renderExample(item.value),
    })),
  };
}

function operationKind(path: string, method: string) {
  if (path === "/oauth/authorize") return "redirect";
  if ((path === "/api/v1/tokens" || path === "/oauth/token" || path === "/api/tools/poll_agent_connection") && method === "post") return "token";
  if (method === "get") return "read";
  if (method === "delete") return "destructive";
  return "write";
}

function operationRisk(path: string, method: string) {
  if ((path === "/api/v1/tokens" || path === "/oauth/token" || path === "/api/tools/start_agent_connection" || path === "/api/tools/poll_agent_connection") && method === "post") return "secret";
  if (path === "/oauth/authorize") return "mutating";
  if (method === "delete") return "destructive";
  if (method === "post" || method === "patch") return "mutating";
  return "safe";
}

function operationGuide(path: string, method: string, operation: OpenApiOperation) {
  if (path === "/oauth/register") {
    return "Registers a public OAuth client. Spoonjoy uses exact redirect URI matches; use HTTPS except localhost or 127.0.0.1.";
  }
  if (path === "/oauth/authorize") {
    return "Browser redirect flow. Open the generated URL after registering a client and generating a PKCE S256 code challenge.";
  }
  if (path === "/oauth/token") {
    return "Form-encoded OAuth endpoint. Exchange a 60-second authorization code or rotate an ort_... refresh token.";
  }
  if (path === "/oauth/revoke") {
    return "Form-encoded OAuth disconnect endpoint. Revoke the stored ort_... refresh token; Spoonjoy also revokes live OAuth access credentials for that client/resource.";
  }
  if (path === "/api/tools/start_agent_connection") {
    return "Starts a 10-minute delegated approval request. Show authorizationUrl and userCode to the chef; never ask for their Spoonjoy password.";
  }
  if (path === "/api/tools/poll_agent_connection") {
    return "Poll with deviceCode no faster than the returned interval. Approved responses return the sj_... token once.";
  }
  if (path === "/mcp") {
    return "Remote MCP JSON-RPC endpoint. Send Authorization: Bearer sj_... after OAuth or delegated approval.";
  }
  if (path === "/api/v1/tokens" && method === "post") {
    return "Creates a real bearer token and returns the sj_... secret once. Use Session mode when you are signed into Spoonjoy; use Bearer only if the pasted token already has tokens:write.";
  }
  if (path.includes("/shopping-list/sync")) {
    return "Use the returned nextCursor only after your client has applied every item and tombstone in the response.";
  }
  if (path === "/api/v1/shopping-list" && method === "get") {
    return "Returns the unpaginated active shopping list. Tiny devices should prefer /api/v1/shopping-list/sync?limit=N and persist nextCursor after applying each page.";
  }
  if (path.includes("/shopping-list/items") && method !== "get") {
    return "Mutates the signed-in chef's shopping list. Reuse the same clientMutationId when retrying the same request after a timeout.";
  }
  if (operation["x-auth"] === "bearer") {
    return "Requires an authenticated chef. Session mode uses your Spoonjoy login; Bearer mode uses a pasted sj_... token for external-client testing.";
  }
  return "Anonymous is enough for public reads. If you send Session or Bearer credentials, Spoonjoy validates them and checks the listed scopes.";
}

function responseSummaries(operation: OpenApiOperation) {
  return Object.entries(operation.responses ?? {})
    .map(([status, response]) => ({
      status,
      description: response?.description ?? "",
    }))
    .sort((left, right) => Number(left.status) - Number(right.status));
}

function responseExamples(operation: OpenApiOperation) {
  const priority = new Map([
    ["idempotency_in_progress", 0],
    ["idempotency_conflict", 1],
    ["pending", 0],
    ["approved", 1],
    ["denied", 2],
    ["expired", 3],
    ["claimed", 4],
  ]);
  return Object.entries(operation.responses ?? {})
    .flatMap(([status, response]) => {
      const media = response?.content?.["application/json"];
      const examples = media?.examples
        ? Object.entries(media.examples).map(([name, item]) => ({ name, value: item.value }))
        : media?.example !== undefined
          ? [{ name: "example", value: media.example }]
          : [];
      return examples
        .filter((example) => example.value !== undefined)
        .sort((left, right) => (priority.get(left.name) ?? 100) - (priority.get(right.name) ?? 100))
        .slice(0, 5)
        .map((example) => ({
          status,
          name: example.name,
          label: titleCase(example.name),
          example: JSON.stringify(example.value, null, 2),
        }));
    })
    .slice(0, 8);
}

function operationProfiles(
  path: string,
  method: string,
  connectorOperations: Set<string>,
  sdkOperations: Set<string>,
): ApiPlaygroundProfile[] {
  const id = `${method.toUpperCase()} ${path}`;
  return [
    "full",
    ...(connectorOperations.has(id) ? ["connector" as const] : []),
    ...(sdkOperations.has(id) ? ["sdk" as const] : []),
  ];
}

function operationIds(document: Pick<OpenApiDocument, "paths">): Set<string> {
  const ids = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of Object.keys(pathItem as Record<string, OpenApiOperation>)) {
      if (OPENAPI_OPERATION_METHOD_SET.has(method)) ids.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ids;
}

function operationFromOpenApi(
  path: string,
  method: string,
  operation: OpenApiOperation,
  connectorOperations: Set<string>,
  sdkOperations: Set<string>,
) {
  const operationId = operation.operationId ?? `${method}_${path}`;
  const tag = operation.tags?.[0] ?? "API";
  const auth = operation["x-auth"] === "bearer" ? "authenticated" : "optional";
  return {
    id: `${method.toUpperCase()} ${path}`,
    operationId,
    label: operation.summary ?? titleCase(operationId),
    method: method.toUpperCase(),
    path,
    profiles: operationProfiles(path, method, connectorOperations, sdkOperations),
    tag,
    auth,
    scopes: operation["x-scopes"] ?? [],
    grantableScopes: operation["x-grantable-scopes"] ?? [],
    acceptedOauthScopes: operation["x-accepted-oauth-scopes"] ?? [],
    credentialModes: operation["x-credential-modes"] ?? (auth === "authenticated" ? ["session", "bearer"] : ["anonymous", "session", "bearer"]),
    retryPolicy: operation["x-retry-policy"] ?? null,
    cursorPolicy: operation["x-cursor-policy"] ?? null,
    idempotency: operation["x-idempotency"] ?? null,
    personalTokenOnly: Boolean(operation["x-personal-token-only"]),
    oauthNote: operation["x-oauth-note"] ?? "",
    selfRevokeException: operation["x-self-revoke-exception"] ?? "",
    kind: operationKind(path, method),
    risk: operationRisk(path, method),
    guide: operationGuide(path, method, operation),
    params: (operation.parameters ?? []).map((parameter) => parameterFromOpenApi(path, parameter)),
    requestBody: requestBodyExample(operation),
    responseStatuses: responseSummaries(operation).map((response) => response.status),
    responseSummaries: responseSummaries(operation),
    responseExamples: responseExamples(operation),
  };
}

export function buildApiPlaygroundManifest(document: OpenApiDocument = buildApiV1OpenApiDocument()) {
  const operations = [];
  const connectorOperations = operationIds(buildApiV1ConnectorOpenApiDocument());
  const sdkOperations = operationIds(buildApiV1SdkOpenApiDocument());

  for (const [path, pathItem] of Object.entries(document.paths)) {
    const operationsByMethod = pathItem as Record<string, OpenApiOperation>;
    for (const [method, operation] of Object.entries(operationsByMethod)) {
      if (!OPENAPI_OPERATION_METHOD_SET.has(method)) continue;
      operations.push(operationFromOpenApi(path, method, operation, connectorOperations, sdkOperations));
    }
  }

  return {
    source: "buildApiV1OpenApiDocument",
    version: document.info.version,
    authFlows: (document["x-auth-flows"] ?? []) as ApiPlaygroundAuthFlow[],
    clientScenarios: (document["x-client-scenarios"] ?? []) as ApiPlaygroundClientScenario[],
    oauthScopeMap: (document["x-oauth-scope-map"] ?? {}) as Record<string, string[]>,
    currentCapabilities: (document["x-current-capabilities"] ?? { available: [], notYetAvailable: [] }) as ApiPlaygroundCapabilities,
    operations,
  };
}

export function serializeApiPlaygroundManifest(manifest = buildApiPlaygroundManifest()) {
  return `// Generated by scripts/generate-api-playground.ts. Do not edit by hand.
export type ApiV1PlaygroundMethod = "GET" | "PUT" | "POST" | "DELETE" | "OPTIONS" | "HEAD" | "PATCH" | "TRACE";
export type ApiV1PlaygroundAuth = "optional" | "authenticated";
export type ApiV1PlaygroundCredentialMode = "anonymous" | "session" | "bearer" | "oauth_pkce";
export type ApiV1PlaygroundProfile = "full" | "connector" | "sdk";
export type ApiV1PlaygroundOperationKind = "read" | "write" | "destructive" | "token" | "redirect";
export type ApiV1PlaygroundOperationRisk = "safe" | "mutating" | "destructive" | "secret";
export type ApiV1PlaygroundParam = {
  name: string;
  in: "path" | "query" | "header";
  label: string;
  required: boolean;
  defaultValue: string;
	  placeholder: string;
	  description: string;
	  schema: {
    type: string;
    format?: string;
    minimum?: number;
    maximum?: number;
  };
};
export type ApiV1PlaygroundOperation = {
  id: string;
  operationId: string;
  label: string;
  method: ApiV1PlaygroundMethod;
  path: string;
  profiles: readonly ApiV1PlaygroundProfile[];
  tag: string;
  auth: ApiV1PlaygroundAuth;
	  scopes: readonly string[];
	  grantableScopes: readonly string[];
	  acceptedOauthScopes: readonly (readonly string[])[];
	  credentialModes: readonly ApiV1PlaygroundCredentialMode[];
  retryPolicy: Record<string, unknown> | null;
  cursorPolicy: Record<string, unknown> | null;
  idempotency: Record<string, unknown> | null;
  personalTokenOnly: boolean;
  oauthNote: string;
  selfRevokeException: string;
  kind: ApiV1PlaygroundOperationKind;
  risk: ApiV1PlaygroundOperationRisk;
  guide: string;
  params: readonly ApiV1PlaygroundParam[];
  requestBody: null | {
    required: boolean;
    contentType: "application/json" | "application/x-www-form-urlencoded";
    example: string;
    examples: readonly {
      name: string;
      label: string;
      example: string;
    }[];
  };
  responseStatuses: readonly string[];
	  responseSummaries: readonly {
	    status: string;
	    description: string;
	  }[];
	  responseExamples: readonly {
	    status: string;
	    name: string;
	    label: string;
	    example: string;
	  }[];
	};
export type ApiV1PlaygroundManifest = {
  source: "buildApiV1OpenApiDocument";
  version: string;
  authFlows: readonly {
    id: string;
    title: string;
    eyebrow: string;
    audience: string;
    endpoints: readonly string[];
    scopes: readonly string[];
    notes: readonly string[];
    sample: string;
  }[];
  clientScenarios: readonly {
    id: string;
    title: string;
    eyebrow: string;
    audience: string;
    notes: readonly string[];
    sample: string;
  }[];
  oauthScopeMap: Record<string, readonly string[]>;
  currentCapabilities: {
    available: readonly string[];
    notYetAvailable: readonly string[];
  };
  operations: readonly ApiV1PlaygroundOperation[];
};

export const API_V1_PLAYGROUND_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const satisfies ApiV1PlaygroundManifest;
`;
}

async function writeGeneratedManifest() {
  const outputPath = fileURLToPath(new URL(`../${OUTPUT_FILE}`, import.meta.url));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializeApiPlaygroundManifest(), "utf8");
  console.log(`Generated ${OUTPUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeGeneratedManifest();
}
