import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import { usePostHog } from "~/lib/use-posthog";
import { Braces, CheckCircle2, Clipboard, KeyRound, Play, RefreshCw, Search, Terminal, XCircle } from "lucide-react";
import {
  API_V1_PLAYGROUND_MANIFEST,
  type ApiV1PlaygroundManifest,
  type ApiV1PlaygroundOperation,
  type ApiV1PlaygroundParam,
} from "~/lib/generated/api-v1-playground";
import { captureSafeClientEvent, latencyBucket, responseStatusClass } from "~/lib/analytics";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, PAGE_OG_CARDS, absoluteUrlFromPreferredBase, pageOgPath } from "~/lib/og-metadata";
import { getUserId } from "~/lib/session.server";
import { Badge } from "~/components/ouro/badge/badge";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { Empty } from "~/components/ouro/empty/empty";
import { FileField } from "~/components/ouro/file-field/file-field";
import { Link } from "~/components/ouro/link/link";
import { SegmentedControl } from "~/components/ouro/segmented-control/segmented-control";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Heading } from "~/components/ouro/text/heading";
import { Button } from "~/components/button";
import { CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";

type PlaygroundAuthMode = "session" | "bearer" | "anonymous";
type PlaygroundSurface = "full" | "connector" | "sdk";

type PlaygroundResponse = {
  status: number;
  statusText: string;
  requestId: string | null;
  headers: Array<{ name: string; value: string }>;
  body: string;
  method?: string;
  path?: string;
  elapsedMs: number;
  secrets?: Array<{ label: string; value: string }>;
};
type MultipartValues = Record<string, string>;
type MultipartField = NonNullable<ApiV1PlaygroundOperation["requestBody"]>["fields"][number];

export const PLAYGROUND_OPERATIONS: readonly ApiV1PlaygroundOperation[] = API_V1_PLAYGROUND_MANIFEST.operations;

const PLAYGROUND_OG_CARD = PAGE_OG_CARDS["api-playground"];
const PLAYGROUND_CANONICAL_PATH = "/api/playground";
const PLAYGROUND_OG_PATH = pageOgPath("api-playground");

const AUTH_MODES: Array<{ id: PlaygroundAuthMode; label: string }> = [
  { id: "session", label: "Session" },
  { id: "bearer", label: "Bearer" },
  { id: "anonymous", label: "Anonymous" },
];

const SURFACES: Array<{ id: PlaygroundSurface; label: string; url: string; body: string }> = [
  { id: "full", label: "All APIs", url: "/api/v1/openapi.json", body: "Full docs and playground source of truth." },
  { id: "connector", label: "Connector", url: "/api/v1/openapi.connector.json", body: "OpenAPI 3.0 REST profile for no-code importers." },
  { id: "sdk", label: "SDK", url: "/api/v1/openapi.sdk.json", body: "REST plus OAuth and delegated approval bootstrap for generated SDKs." },
];
const PKCE_SESSION_STORAGE_KEY = "spoonjoy.playground.pkce";

export function absoluteSpecUrl(path: string, origin: string) {
  return new URL(path, origin).toString();
}

function defaultParams(operation: ApiV1PlaygroundOperation): Record<string, string> {
  return Object.fromEntries(operation.params.map((param) => [param.name, param.defaultValue]));
}

function defaultBodies(operations: readonly ApiV1PlaygroundOperation[]): Record<string, string> {
  return Object.fromEntries(
    operations.map((operation) => [operation.id, operation.requestBody?.example ?? ""]),
  );
}

function defaultMultipartValuesFor(operation: ApiV1PlaygroundOperation): MultipartValues {
  if (operation.requestBody?.contentType !== "multipart/form-data") return {};
  try {
    const parsed = JSON.parse(operation.requestBody.example) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      operation.requestBody.fields
        .filter((field) => !field.accept)
        .map((field) => {
          const value = (parsed as Record<string, unknown>)[field.name];
          return [field.name, value === undefined || value === null ? "" : String(value)];
        }),
    );
  } catch {
    return {};
  }
}

function defaultMultipartValuesByOperation(operations: readonly ApiV1PlaygroundOperation[]) {
  return Object.fromEntries(operations.map((operation) => [operation.id, defaultMultipartValuesFor(operation)]));
}

function defaultParamsByOperation(operations: readonly ApiV1PlaygroundOperation[]) {
  return Object.fromEntries(operations.map((operation) => [operation.id, defaultParams(operation)]));
}

function pathParamValue(param: ApiV1PlaygroundParam, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? encodeURIComponent(trimmed) : `REPLACE_${param.name}`;
}

function queryParamValue(param: ApiV1PlaygroundParam, value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : param.required ? `REPLACE_${param.name}` : "";
}

export function playgroundPath(operation: ApiV1PlaygroundOperation, params: Record<string, string>) {
  let path = operation.path;
  const search = new URLSearchParams();

  for (const param of operation.params) {
    const value = params[param.name]?.trim();
    if (param.in === "path") {
      path = path.replace(`{${param.name}}`, pathParamValue(param, value));
      continue;
    }
    if (param.in === "header") continue;
    const queryValue = queryParamValue(param, value);
    if (queryValue) search.set(param.name, queryValue);
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function missingRequiredParams(operation: ApiV1PlaygroundOperation, params: Record<string, string>) {
  return operation.params.filter((param) => param.required && !params[param.name]?.trim());
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function multipartTextValue(field: MultipartField, values: MultipartValues) {
  const value = values[field.name]?.trim();
  return value || (field.required ? `REPLACE_${field.name}` : "");
}

export function curlFor(
  path: string,
  operation: ApiV1PlaygroundOperation,
  authMode: PlaygroundAuthMode,
  bodyText: string,
  baseUrl = "https://spoonjoy.app",
  params: Record<string, string> = {},
  multipartValues: MultipartValues = defaultMultipartValuesFor(operation),
) {
  const absoluteUrl = `${baseUrl.replace(/\/$/, "")}${path}`;
  const isMultipart = operation.requestBody?.contentType === "multipart/form-data";
  if (operation.kind === "redirect") {
    return [
      "# Browser redirect flow: open this authorization URL after filling client_id, redirect_uri, state, and code_challenge.",
      `open ${shellQuote(absoluteUrl)}`,
    ].join("\n");
  }

  if (authMode === "session") {
    const headers = operation.params
      .filter((param) => param.in === "header" && params[param.name]?.trim())
      .map((param) => `    ${JSON.stringify(param.name)}: ${JSON.stringify(params[param.name]!.trim())},`);
    if (isMultipart) {
      const fields = operation.requestBody?.fields.length
        ? operation.requestBody.fields
        : [{ name: "file", label: "File", required: true, accept: "application/octet-stream", description: "" }];
      const appendLines = fields.flatMap((field) => (
        field.accept
          ? [`body.append(${JSON.stringify(field.name)}, fileInput.files[0]);`]
          : [`body.append(${JSON.stringify(field.name)}, ${JSON.stringify(multipartTextValue(field, multipartValues))});`]
      ));
      return [
        "// Session mode is browser-only: run from a signed-in Spoonjoy page.",
        "const body = new FormData();",
        ...appendLines,
        `await fetch(${JSON.stringify(path)}, {`,
        `  method: ${JSON.stringify(operation.method)},`,
        `  credentials: "same-origin",`,
        ...(headers.length ? ["  headers: {", ...headers, "  },"] : []),
        "  body,",
        "});",
      ].join("\n");
    }
    return [
      "// Session mode is browser-only: run from a signed-in Spoonjoy page.",
      `await fetch(${JSON.stringify(path)}, {`,
      `  method: ${JSON.stringify(operation.method)},`,
      `  credentials: "same-origin",`,
      ...(headers.length || bodyText.trim()
        ? [
            "  headers: {",
            ...headers,
            ...(bodyText.trim() ? [`    "Content-Type": ${JSON.stringify(operation.requestBody?.contentType ?? "application/json")},`] : []),
            "  },",
          ]
        : []),
      ...(bodyText.trim() ? [`  body: ${JSON.stringify(bodyText.trim())},`] : []),
      "});",
    ].join("\n");
  }

  const lines = [`curl ${shellQuote(absoluteUrl)}`];
  if (operation.method !== "GET") lines.push(`  -X ${operation.method}`);
  lines.push("  -H 'X-Request-Id: pg_example'");
  if (authMode === "bearer") lines.push("  -H 'Authorization: Bearer $SPOONJOY_TOKEN'");
  for (const param of operation.params) {
    if (param.in === "header" && params[param.name]?.trim()) {
      lines.push(`  -H ${shellQuote(`${param.name}: ${params[param.name]!.trim()}`)}`);
    }
  }
  if (isMultipart) {
    const fields = operation.requestBody?.fields.length
      ? operation.requestBody.fields
      : [{ name: "file", label: "File", required: true, accept: "application/octet-stream", description: "" }];
    for (const field of fields) {
      if (!field.accept) {
        const value = multipartTextValue(field, multipartValues);
        if (value) lines.push(`  -F ${shellQuote(`${field.name}=${value}`)}`);
        continue;
      }
      const contentType = field.accept.split(",")[0] || "application/octet-stream";
      lines.push(`  -F ${shellQuote(`${field.name}=@profile.jpg;type=${contentType}`)}`);
    }
  } else if (bodyText.trim()) {
    lines.push(`  -H 'Content-Type: ${operation.requestBody?.contentType ?? "application/json"}'`);
    lines.push(`  --data ${shellQuote(bodyText.trim())}`);
  }

  return lines.join(" \\\n");
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const SECRET_VALUE_PATTERN = /\b(?:sj|ort|sjdc)_[A-Za-z0-9_-]+\b/g;

function labelForSecret(key: string) {
  if (key === "refresh_token" || key.toLowerCase().includes("refresh")) return "refresh token";
  if (key === "deviceCode" || key.toLowerCase().includes("device")) return "device code";
  if (key === "access_token" || key === "token" || key.toLowerCase().includes("token")) return "token";
  return "secret";
}

function redactSecretText(value: string, label: string, secrets: Array<{ label: string; value: string }>) {
  return value.replace(SECRET_VALUE_PATTERN, (secret) => {
    if (!secrets.some((existing) => existing.value === secret)) secrets.push({ label, value: secret });
    const prefix = secret.slice(0, secret.indexOf("_") + 1);
    return `${prefix}...redacted`;
  });
}

function redactSecretJson(value: unknown, key: string, secrets: Array<{ label: string; value: string }>): unknown {
  if (typeof value === "string") return redactSecretText(value, labelForSecret(key), secrets);
  if (Array.isArray(value)) return value.map((item) => redactSecretJson(item, key, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      redactSecretJson(childValue, childKey, secrets),
    ]),
  );
}

export function playgroundRequestId(
  cryptoLike: Pick<Crypto, "randomUUID"> | null | undefined = globalThis.crypto,
  now = Date.now(),
) {
  if (cryptoLike && "randomUUID" in cryptoLike) {
    return `pg_${cryptoLike.randomUUID()}`;
  }
  return `pg_${now}`;
}

export function playgroundFetchOptions(
  operation: ApiV1PlaygroundOperation,
  authMode: PlaygroundAuthMode,
  token: string,
  bodyText: string,
  requestId = playgroundRequestId(),
  params: Record<string, string> = {},
  multipartFiles: Record<string, File | null> = {},
  multipartValues: MultipartValues = {},
): RequestInit {
  const headers: Record<string, string> = { "X-Request-Id": requestId };
  if (authMode === "bearer" && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  for (const param of operation.params) {
    if (param.in === "header" && params[param.name]?.trim()) {
      headers[param.name] = params[param.name]!.trim();
    }
  }
  const trimmedBody = bodyText.trim();
  const isMultipart = operation.requestBody?.contentType === "multipart/form-data";
  if (trimmedBody && operation.method !== "GET" && !isMultipart) {
    headers["Content-Type"] = operation.requestBody!.contentType;
  }
  let multipartBody: FormData | null = null;
  if (isMultipart && operation.method !== "GET") {
    multipartBody = new FormData();
    let hasMultipartBody = false;
    for (const field of operation.requestBody?.fields ?? []) {
      if (field.accept) {
        const file = multipartFiles[field.name];
        if (!file) continue;
        multipartBody.append(field.name, file);
        hasMultipartBody = true;
        continue;
      }
      const value = multipartValues[field.name]?.trim();
      if (!value) continue;
      multipartBody.append(field.name, value);
      hasMultipartBody = true;
    }
    if (!hasMultipartBody) multipartBody = null;
  }

  return {
    method: operation.method,
    credentials: authMode === "session" ? "same-origin" : "omit",
    headers,
    ...(multipartBody ? { body: multipartBody } : trimmedBody && operation.method !== "GET" ? { body: trimmedBody } : {}),
  };
}

export function playgroundBodyError(
  operation: ApiV1PlaygroundOperation,
  bodyText: string,
  multipartFiles: Record<string, File | null> = {},
  multipartValues: MultipartValues = {},
) {
  if (!operation.requestBody) return null;
  if (operation.requestBody.contentType === "multipart/form-data") {
    const missingField = operation.requestBody.fields.find((field) => (
      field.required &&
      (field.accept ? !multipartFiles[field.name] : !multipartValues[field.name]?.trim())
    ));
    return missingField ? `Select ${missingField.label.toLowerCase()} before sending.` : null;
  }
  const trimmedBody = bodyText.trim();
  if (operation.requestBody.required && !trimmedBody) return "This operation requires a request body.";
  if (!trimmedBody || operation.requestBody.contentType !== "application/json") return null;
  try {
    JSON.parse(trimmedBody);
    return null;
  } catch {
    return "JSON body is not valid.";
  }
}

function responseHeadersFrom(result: Response) {
  const exposed = ["X-Request-Id", "Retry-After", "WWW-Authenticate", "Location", "Cache-Control", "Content-Type"];
  return exposed
    .map((name) => ({ name, value: result.headers.get(name) }))
    .filter((header): header is { name: string; value: string } => Boolean(header.value));
}

export async function playgroundResponseFromFetchResult(
  result: Response,
  meta: Partial<Pick<PlaygroundResponse, "method" | "path" | "elapsedMs">> = {},
  options: { maskSecrets?: boolean } = {},
): Promise<PlaygroundResponse> {
  const text = await result.text();
  let body = text;
  const secrets: Array<{ label: string; value: string }> = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    body = prettyJson(options.maskSecrets ? redactSecretJson(parsed, "secret", secrets) : parsed);
  } catch {
    body = options.maskSecrets ? redactSecretText(text, "secret", secrets) : text;
    body ||= "(empty response)";
  }
  return {
    status: result.status,
    statusText: result.statusText || (result.ok ? "OK" : "ERROR"),
    requestId: result.headers.get("X-Request-Id"),
    headers: responseHeadersFrom(result),
    body,
    ...(secrets.length ? { secrets } : {}),
    ...meta,
    elapsedMs: meta.elapsedMs ?? 0,
  };
}

export function playgroundNetworkError(error: unknown): PlaygroundResponse {
  return {
    status: 0,
    statusText: "NETWORK ERROR",
    requestId: null,
    headers: [],
    body: error instanceof Error ? error.message : "Request failed",
    elapsedMs: 0,
  };
}

export function playgroundOperationGroups(operations: readonly ApiV1PlaygroundOperation[] = PLAYGROUND_OPERATIONS) {
  const groups: Array<{ tag: string; operations: ApiV1PlaygroundOperation[] }> = [];
  for (const operation of operations) {
    let group = groups.find((candidate) => candidate.tag === operation.tag);
    if (!group) {
      group = { tag: operation.tag, operations: [] };
      groups.push(group);
    }
    group.operations.push(operation);
  }
  return groups;
}

function playgroundAuthStatus(isAuthenticated: boolean) {
  return isAuthenticated ? "authenticated" : "anonymous";
}

function playgroundOperationTelemetry(operation: ApiV1PlaygroundOperation) {
  return {
    operation_id: operation.id,
    operation_group: operation.tag,
    operation_kind: operation.kind,
    operation_risk: operation.risk,
    operation_auth: operation.auth,
    method: operation.method,
  };
}

export function playgroundOutcomeForStatus(status: number) {
  if (status === 0) return "network_error";
  return status >= 200 && status < 400 ? "success" : "error";
}

function operationCountForSurface(operations: readonly ApiV1PlaygroundOperation[], surface: PlaygroundSurface) {
  return operations.filter((operation) => operation.profiles.includes(surface)).length;
}

export function meta({ data }: { data?: { canonicalUrl?: string; ogImageUrl?: string } } = {}) {
  const canonicalUrl = data?.canonicalUrl ?? `https://spoonjoy.app${PLAYGROUND_CANONICAL_PATH}`;
  const ogImageUrl = data?.ogImageUrl ?? `https://spoonjoy.app${PLAYGROUND_OG_PATH}`;

  return [
    { title: `${PLAYGROUND_OG_CARD.title} | Spoonjoy` },
    {
      name: "description",
      content: PLAYGROUND_OG_CARD.description,
    },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: PLAYGROUND_OG_CARD.title },
    { property: "og:description", content: PLAYGROUND_OG_CARD.description },
    { property: "og:url", content: canonicalUrl },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
    { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
    { property: "og:image:type", content: "image/svg+xml" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: PLAYGROUND_OG_CARD.title },
    { name: "twitter:description", content: PLAYGROUND_OG_CARD.description },
    { name: "twitter:image", content: ogImageUrl },
  ];
}

type PlaygroundLoaderEnv = Pick<Env, "SESSION_SECRET" | "SPOONJOY_BASE_URL">;

export async function loader(args?: { request?: Request; context?: { cloudflare?: { env?: PlaygroundLoaderEnv | null } } }): Promise<{
  manifest: ApiV1PlaygroundManifest;
  canonicalUrl: string;
  ogImageUrl: string;
  requestOrigin: string;
  viewer: { isAuthenticated: boolean };
}> {
  const requestUrl = args?.request?.url;
  const baseUrl = args?.context?.cloudflare?.env?.SPOONJOY_BASE_URL;
  const userId = args?.request
    ? await getUserId(args.request, args.context?.cloudflare?.env)
    : null;

  return {
    manifest: API_V1_PLAYGROUND_MANIFEST,
    canonicalUrl: absoluteUrlFromPreferredBase({ requestUrl, baseUrl, path: PLAYGROUND_CANONICAL_PATH }),
    ogImageUrl: absoluteUrlFromPreferredBase({ requestUrl, baseUrl, path: PLAYGROUND_OG_PATH }),
    requestOrigin: new URL(requestUrl ?? "https://spoonjoy.app").origin,
    viewer: { isAuthenticated: Boolean(userId) },
  };
}

function methodColor(method: string) {
  if (method === "GET") return "success";
  if (method === "POST") return "warning";
  if (method === "PATCH") return "secondary";
  return "destructive";
}

function riskColor(risk: ApiV1PlaygroundOperation["risk"]) {
  if (risk === "secret") return "destructive";
  if (risk === "destructive") return "destructive";
  if (risk === "mutating") return "warning";
  return "success";
}

function authCopy(mode: PlaygroundAuthMode, isAuthenticated: boolean) {
  if (mode === "session") {
    return isAuthenticated
      ? "Uses your signed-in Spoonjoy session for same-origin API calls."
      : "Uses your current Spoonjoy login for same-origin API calls.";
  }
  if (mode === "bearer") return "Uses the bearer token you paste for external-client testing.";
  return "Omits cookies and Authorization for public-only requests.";
}

function allowedAuthModes(operation: ApiV1PlaygroundOperation) {
  return AUTH_MODES.filter((mode) => operation.credentialModes.includes(mode.id));
}

function defaultAuthModeFor(operation: ApiV1PlaygroundOperation, isAuthenticated: boolean): PlaygroundAuthMode {
  const modes = allowedAuthModes(operation).map((mode) => mode.id);
  if (isAuthenticated && modes.includes("session")) return "session";
  if (operation.auth === "optional" && modes.includes("anonymous")) return "anonymous";
  return modes[0]!;
}

function freshMutationId(operation: ApiV1PlaygroundOperation) {
  /* istanbul ignore next -- @preserve supported browsers expose crypto.randomUUID; Date fallback is for older embedded clients. */
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return `${operation.operationId}:${suffix}`;
}

function bodyHasClientMutationId(bodyText: string) {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && "clientMutationId" in parsed);
  } catch {
    return false;
  }
}

async function copyText(value: string) {
  await navigator.clipboard?.writeText(value);
}

function bytesToBase64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generatePkceVerifier(cryptoLike: Pick<Crypto, "getRandomValues"> = globalThis.crypto) {
  const bytes = new Uint8Array(32);
  cryptoLike.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function generateOauthState(cryptoLike: Pick<Crypto, "getRandomValues"> = globalThis.crypto) {
  const bytes = new Uint8Array(24);
  cryptoLike.getRandomValues(bytes);
  return `state_${bytesToBase64Url(bytes)}`;
}

export async function pkceS256Challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

// TODO(ouro-hx: copy-button): Copying with a "Copied" confirmation becomes HX's copy button once it ships.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function handleCopy() {
    try {
      await copyText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus("idle"), 1600);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button plain size="sm" startIcon={Clipboard} onClick={() => void handleCopy()}>
        {label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? `Copied ${label}` : status === "failed" ? `Could not copy ${label}` : ""}
      </span>
    </span>
  );
}

export default function DeveloperPlayground() {
  const { manifest, viewer, canonicalUrl, requestOrigin } = useLoaderData<typeof loader>();
  const oauthIssuer = new URL(canonicalUrl).origin;
  const posthog = usePostHog();
  const isAuthenticated = viewer.isAuthenticated;
  const operations: readonly ApiV1PlaygroundOperation[] = manifest.operations;
  const [surface, setSurface] = useState<PlaygroundSurface>("full");
  const [operationQuery, setOperationQuery] = useState("");
  const filteredOperations = useMemo(() => {
    const query = operationQuery.trim().toLowerCase();
    return operations.filter((operation) => {
      const matchesSurface = operation.profiles.includes(surface);
      if (!matchesSurface) return false;
      if (!query) return true;
      return [
        operation.label,
        operation.method,
        operation.path,
        operation.tag,
        operation.scopes.join(" "),
        operation.grantableScopes.join(" "),
      ].join(" ").toLowerCase().includes(query);
    });
  }, [operationQuery, operations, surface]);
  const operationGroups = useMemo(() => playgroundOperationGroups(filteredOperations), [filteredOperations]);
  const defaultOperationId = (operations.find((operation) => operation.id === "GET /api/v1/recipes") ?? operations[0]!).id;
  const [selectedId, setSelectedId] = useState<string>(defaultOperationId);
  const selected = operations.find((operation) => operation.id === selectedId)!;
  const selectedSurface = SURFACES.find((item) => item.id === surface)!;
  const [paramsByOperation, setParamsByOperation] = useState<Record<string, Record<string, string>>>(() => (
    defaultParamsByOperation(operations)
  ));
  const [bodiesByOperation, setBodiesByOperation] = useState<Record<string, string>>(() => defaultBodies(operations));
  const [multipartFilesByOperation, setMultipartFilesByOperation] = useState<Record<string, Record<string, File | null>>>({});
  const [multipartValuesByOperation, setMultipartValuesByOperation] = useState<Record<string, MultipartValues>>(() => (
    defaultMultipartValuesByOperation(operations)
  ));
  const [authMode, setAuthMode] = useState<PlaygroundAuthMode>(() => defaultAuthModeFor(selected, isAuthenticated));
  const [token, setToken] = useState("");
  const [pkceVerifier, setPkceVerifier] = useState("");
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState("");
  const [oauthCallbackStatus, setOauthCallbackStatus] = useState("");
  const [confirmedRisk, setConfirmedRisk] = useState(false);
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const [isSending, setIsSending] = useState(false);
  const selectedHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusSelectedOperation = useRef(false);
  const wasAuthenticated = useRef(isAuthenticated);
  const viewedTelemetrySent = useRef(false);

  const params = paramsByOperation[selected.id]!;
  const bodyText = bodiesByOperation[selected.id]!;
  const multipartFiles = multipartFilesByOperation[selected.id] ?? {};
  const multipartValues = multipartValuesByOperation[selected.id]!;
  const path = useMemo(() => playgroundPath(selected, params), [selected, params]);
  const curl = curlFor(path, selected, authMode, bodyText, requestOrigin, params, multipartValues);
  const missingParams = missingRequiredParams(selected, params);
  const authModeAllowed = selected.credentialModes.includes(authMode);
  const bearerError = authMode === "bearer" && !token.trim() ? "Paste a bearer token before sending in Bearer mode." : null;
  const bodyError = playgroundBodyError(selected, bodyText, multipartFiles, multipartValues);
  const riskNeedsConfirmation = selected.risk !== "safe";
  const riskError = riskNeedsConfirmation && !confirmedRisk ? "Confirm this real-data operation before sending." : null;
  const validationErrors = [
    missingParams.length > 0 ? "Set required parameters before sending." : null,
    bearerError,
    bodyError,
    riskError,
    /* istanbul ignore next -- @preserve auth mode state is constrained by generated credentialModes and reset on operation changes. */
    authModeAllowed ? null : "This operation does not support the selected auth mode.",
  ].filter((error): error is string => Boolean(error));
  const canSend = validationErrors.length === 0 && !isSending;
  const visibleAuthModes = allowedAuthModes(selected);
  const validationId = validationErrors.length ? "playground-validation-errors" : undefined;
  const hasBodyMutationId = selected.requestBody?.contentType === "application/json" && (
    bodyHasClientMutationId(bodyText) || bodyHasClientMutationId(selected.requestBody.example)
  );
  const hasHeaderMutationId = selected.params.some((param) => param.name === "X-Client-Mutation-Id");
  const operationPolicies: Array<[string, Record<string, unknown>]> = [];
  if (selected.retryPolicy) operationPolicies.push(["Retry policy", selected.retryPolicy]);
  if (selected.cursorPolicy) operationPolicies.push(["Cursor policy", selected.cursorPolicy]);
  if (selected.idempotency) operationPolicies.push(["Idempotency", selected.idempotency]);

  useEffect(() => {
    if (!focusSelectedOperation.current) return;
    focusSelectedOperation.current = false;
    selectedHeadingRef.current?.focus();
  }, [selected.id]);

  useEffect(() => {
    const justSignedIn = !wasAuthenticated.current && isAuthenticated;
    wasAuthenticated.current = isAuthenticated;
    if (justSignedIn && selected.credentialModes.includes("session")) {
      setAuthMode("session");
      setConfirmedRisk(false);
    }
  }, [isAuthenticated, selected.credentialModes, selected.id]);

  useEffect(() => {
    if (viewedTelemetrySent.current || !posthog) return;
    viewedTelemetrySent.current = true;
    captureSafeClientEvent(posthog, "spoonjoy.developer.playground.viewed", {
      page: "api_playground",
      auth_status: playgroundAuthStatus(isAuthenticated),
      surface,
      operation_count: operations.length,
      auth_mode: authMode,
      ...playgroundOperationTelemetry(selected),
    });
  }, [authMode, isAuthenticated, operations.length, posthog, selected, surface]);

  function nextAuthModeFor(operation: ApiV1PlaygroundOperation, current: PlaygroundAuthMode): PlaygroundAuthMode {
    const modes = allowedAuthModes(operation).map((mode) => mode.id);
    return modes.includes(current) ? current : defaultAuthModeFor(operation, isAuthenticated);
  }

  function selectOperation(id: string, options: { focusBuilder?: boolean } = {}) {
    const operation = operations.find((candidate) => candidate.id === id)!;
    setSelectedId(id);
    setAuthMode((current) => nextAuthModeFor(operation, current));
    focusSelectedOperation.current = Boolean(options.focusBuilder);
    setConfirmedRisk(false);
    setResponse(null);
    capturePlaygroundTelemetry(
      "spoonjoy.developer.playground.operation_selected",
      { auth_mode: nextAuthModeFor(operation, authMode) },
      operation,
    );
  }

  function selectSurface(nextSurface: PlaygroundSurface) {
    setSurface(nextSurface);
    setOperationQuery("");
    captureSafeClientEvent(posthog, "spoonjoy.developer.playground.surface_selected", {
      page: "api_playground",
      auth_status: playgroundAuthStatus(isAuthenticated),
      surface: nextSurface,
      operation_count: operationCountForSurface(operations, nextSurface),
    });
    const nextOperation = operations.find((operation) => operation.profiles.includes(nextSurface));
    if (nextOperation && !selected.profiles.includes(nextSurface)) {
      selectOperation(nextOperation.id);
    }
  }

  function selectAuthMode(nextMode: PlaygroundAuthMode) {
    setAuthMode(nextMode);
    setConfirmedRisk(false);
    capturePlaygroundTelemetry("spoonjoy.developer.playground.auth_mode_selected", {
      auth_mode: nextMode,
    }, selected);
  }

  function updateParam(name: string, value: string) {
    setConfirmedRisk(false);
    setParamsByOperation((current) => ({
      ...current,
      [selected.id]: {
        ...current[selected.id]!,
        [name]: value,
      },
    }));
  }

  function updateBody(value: string) {
    setConfirmedRisk(false);
    setBodiesByOperation((current) => ({
      ...current,
      [selected.id]: value,
    }));
  }

  function updateMultipartFile(name: string, file: File | null) {
    setConfirmedRisk(false);
    setMultipartFilesByOperation((current) => ({
      ...current,
      [selected.id]: {
        ...(current[selected.id] ?? {}),
        [name]: file,
      },
    }));
  }

  function updateMultipartValue(name: string, value: string) {
    setConfirmedRisk(false);
    setMultipartValuesByOperation((current) => ({
      ...current,
      [selected.id]: {
        ...current[selected.id]!,
        [name]: value,
      },
    }));
  }

  function generateBodyMutationId() {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      updateBody(prettyJson({ ...parsed, clientMutationId: freshMutationId(selected) }));
    } catch {
      updateBody(prettyJson({ clientMutationId: freshMutationId(selected) }));
    }
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationErrors.length) return;
    const multipartFilePresent = Object.values(multipartFiles).some(Boolean);
    const multipartTextPresent = Object.values(multipartValues).some((value) => value.trim());
    const multipartBodyPresent = selected.requestBody?.contentType === "multipart/form-data"
      ? multipartFilePresent || multipartTextPresent
      : false;
    capturePlaygroundTelemetry("spoonjoy.developer.playground.request_submitted", {
      request_body_present: Boolean((bodyText.trim() || multipartBodyPresent) && selected.method !== "GET"),
      validation_error_count: validationErrors.length,
    }, selected);
    if (selected.kind === "redirect") {
      if (pkceVerifier) {
        window.sessionStorage?.setItem(PKCE_SESSION_STORAGE_KEY, JSON.stringify({
          code_verifier: pkceVerifier,
          state: params.state,
          code_challenge: params.code_challenge,
          client_id: params.client_id,
          redirect_uri: params.redirect_uri,
          issuer: oauthIssuer,
        }));
      }
      window.open(path, "_blank", "noopener,noreferrer");
      return;
    }
    setIsSending(true);
    const startedAt = Date.now();
    try {
      const result = await fetch(path, playgroundFetchOptions(selected, authMode, token, bodyText, playgroundRequestId(), params, multipartFiles, multipartValues));
      const elapsedMs = Date.now() - startedAt;
      setResponse(await playgroundResponseFromFetchResult(result, {
        method: selected.method,
        path,
        elapsedMs,
      }, { maskSecrets: selected.risk === "secret" }));
      capturePlaygroundTelemetry("spoonjoy.developer.playground.response_received", {
        outcome: playgroundOutcomeForStatus(result.status),
        response_status: result.status,
        response_status_class: responseStatusClass(result.status),
        latency_bucket: latencyBucket(elapsedMs),
      }, selected);
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      setResponse({
        ...playgroundNetworkError(error),
        method: selected.method,
        path,
        elapsedMs,
      });
      capturePlaygroundTelemetry("spoonjoy.developer.playground.response_received", {
        outcome: "network_error",
        response_status: 0,
        response_status_class: responseStatusClass(0),
        latency_bucket: latencyBucket(elapsedMs),
      }, selected);
    } finally {
      setIsSending(false);
    }
  }

	  async function generatePkce() {
	    const verifier = generatePkceVerifier();
	    const state = generateOauthState();
	    const challenge = await pkceS256Challenge(verifier);
	    setPkceVerifier(verifier);
	    updateParam("code_challenge", challenge);
	    updateParam("code_challenge_method", "S256");
	    updateParam("state", state);
      window.sessionStorage?.setItem(PKCE_SESSION_STORAGE_KEY, JSON.stringify({
        code_verifier: verifier,
        state,
        code_challenge: challenge,
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        issuer: oauthIssuer,
      }));
    }

  function prepareOauthTokenExchange() {
    try {
      const callbackInput = oauthCallbackUrl.trim();
      /* istanbul ignore next -- @preserve absolute and ?query callback inputs are covered; bare query text is convenience parsing. */
      const parsedCallback = new URL(callbackInput.startsWith("?") ? callbackInput : callbackInput.includes("://") ? callbackInput : `?${callbackInput}`, window.location.origin);
      const code = parsedCallback.searchParams.get("code")?.trim();
      const callbackState = parsedCallback.searchParams.get("state")?.trim();
      const callbackIssuer = parsedCallback.searchParams.get("iss")?.trim();
      const storedRaw = window.sessionStorage?.getItem(PKCE_SESSION_STORAGE_KEY);
      const stored = storedRaw ? JSON.parse(storedRaw) as Record<string, string> : {};
      /* istanbul ignore next -- @preserve generated OAuth params include these values before exchange preparation. */
      const expectedState = stored.state || params.state || "";
      const codeVerifier = stored.code_verifier || pkceVerifier;
      /* istanbul ignore next -- @preserve generated OAuth params include these values before exchange preparation. */
      const clientId = stored.client_id || params.client_id || "";
      /* istanbul ignore next -- @preserve generated OAuth params include these values before exchange preparation. */
      const redirectUri = stored.redirect_uri || params.redirect_uri || "";
      if (!code) {
        setOauthCallbackStatus("Callback URL is missing code.");
        return;
      }
      if (!callbackState || callbackState !== expectedState) {
        setOauthCallbackStatus("Callback state does not match the stored PKCE state.");
        return;
      }
      const expectedIssuer = stored.issuer || oauthIssuer;
      if (!callbackIssuer || callbackIssuer !== expectedIssuer) {
        setOauthCallbackStatus("Callback issuer is missing or does not match the stored authorization server.");
        return;
      }
      if (!codeVerifier || !clientId || !redirectUri) {
        setOauthCallbackStatus("Missing code_verifier, client_id, or redirect_uri. Generate PKCE and fill the authorize fields first.");
        return;
      }
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }).toString();
      const tokenOperation = operations.find((operation) => operation.id === "POST /oauth/token");
      if (!tokenOperation) {
        setOauthCallbackStatus("OAuth token operation is not available in this playground manifest.");
        return;
      }
      setSelectedId(tokenOperation.id);
      setAuthMode("anonymous");
      setBodiesByOperation((current) => ({ ...current, [tokenOperation.id]: body }));
      setConfirmedRisk(false);
      setResponse(null);
      focusSelectedOperation.current = true;
      setOauthCallbackStatus("Token exchange body prepared. Send POST /oauth/token to complete the flow.");
    } catch {
      setOauthCallbackStatus("Callback URL is not a valid URL or query string.");
    }
  }

  const bodyLabel = selected.requestBody?.contentType === "application/x-www-form-urlencoded"
    ? "Form body"
    : selected.requestBody?.contentType === "multipart/form-data"
      ? "Multipart body"
      : "JSON body";

  function capturePlaygroundTelemetry(
    event: string,
    properties: Record<string, unknown>,
    operation: ApiV1PlaygroundOperation,
  ) {
    captureSafeClientEvent(posthog, event, {
      page: "api_playground",
      auth_status: playgroundAuthStatus(isAuthenticated),
      surface,
      auth_mode: authMode,
      ...playgroundOperationTelemetry(operation),
      ...properties,
    });
  }

  return (
    <CookbookPage className="sj-developer-playground">
      <PageHeader
        eyebrow={`API ${manifest.version}`}
        title="Spoonjoy API Playground"
        size="lg"
        divider
        description="Generated from the live v1 OpenAPI surface. Sign into Spoonjoy and the playground uses that session for private, scoped, and mutating calls."
        actions={(
        <Button href="/api" plain>
          <Terminal data-slot="icon" aria-hidden="true" />
          Docs
        </Button>
      )}
      />

      <section className="grid gap-4 border-y border-[var(--sj-border-strong)] py-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
        <div className="grid gap-3">
          <SegmentedControl
            label="API surface"
            items={SURFACES.map(({ id, label }) => ({ value: id, label }))}
            value={surface}
            onValueChange={(value) => selectSurface(value as PlaygroundSurface)}
          />
          <p className="text-sm/6 text-[var(--sj-ink-soft)]">
            {selectedSurface.body}
          </p>
        </div>
        <div className="grid gap-2">
          <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Import URL</p>
          <p className="break-words font-mono text-xs/5 text-[var(--sj-ink-soft)]">
            {absoluteSpecUrl(selectedSurface.url, requestOrigin)}
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={absoluteSpecUrl(selectedSurface.url, requestOrigin)} label="Copy import URL" />
            <Button href={selectedSurface.url} plain>
              <Braces data-slot="icon" aria-hidden="true" />
              Open spec
            </Button>
          </div>
        </div>
      </section>

      <form onSubmit={sendRequest} className="grid min-w-0 gap-6 border-t border-[var(--sj-border-strong)] py-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="grid min-w-0 gap-5">
          <div className="min-w-0 border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Heading ref={selectedHeadingRef} tabIndex={-1} level={2} className="min-w-0 break-words">
                  {selected.label}
                </Heading>
                <p className="mt-2 break-words font-mono text-sm/6 text-[var(--sj-ink-soft)]">{selected.path}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={methodColor(selected.method)} variant="soft">
                  {selected.method}
                </Badge>
                <Badge tone={selected.auth === "authenticated" ? "warning" : "secondary"} variant="soft">
                  {selected.auth === "authenticated" ? "Authenticated chef" : "Auth optional"}
                </Badge>
                <Badge tone={riskColor(selected.risk)} variant="soft">
                  {selected.risk}
                </Badge>
                {selected.credentialModes.map((mode) => <Badge key={mode} variant="soft">{mode}</Badge>)}
                {selected.scopes.map((scope) => <Badge key={scope} variant="soft">{scope}</Badge>)}
              </div>
            </div>
            <p className="mt-4 border-l-2 border-[var(--sj-brass)] pl-3 text-sm/6 text-[var(--sj-ink-soft)]">
              {selected.guide}
            </p>

            {selected.acceptedOauthScopes.length || selected.grantableScopes.length || selected.personalTokenOnly || selected.selfRevokeException || operationPolicies.length ? (
              <div className="mt-5 grid gap-3 border-y border-[var(--sj-border)] py-5">
                <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Generated behavior</p>
                {selected.grantableScopes.length ? (
                  <div className="grid gap-2">
                    <p className="text-sm/6 text-[var(--sj-ink-soft)]">Grantable scopes for this flow</p>
                    <div className="flex flex-wrap gap-2">
                      {selected.grantableScopes.map((scope) => (
                        <Badge key={scope} variant="soft">{scope}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selected.acceptedOauthScopes.length ? (
                  <div className="grid gap-2">
                    <p className="text-sm/6 text-[var(--sj-ink-soft)]">Accepted OAuth alternatives</p>
                    <div className="flex flex-wrap gap-2">
                      {selected.acceptedOauthScopes.map((scopeSet) => (
                        <Badge key={scopeSet.join(" ")} variant="soft">{scopeSet.join(" + ")}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selected.personalTokenOnly ? (
                  <p className="border-l-2 border-[var(--sj-brass)] pl-3 text-sm/6 text-[var(--sj-ink-soft)]">
                    {selected.oauthNote}
                  </p>
                ) : null}
                {selected.selfRevokeException ? (
                  <p className="border-l-2 border-[var(--sj-brass)] pl-3 text-sm/6 text-[var(--sj-ink-soft)]">
                    {selected.selfRevokeException}
                  </p>
                ) : null}
                {operationPolicies.length ? (
                  <div className="grid gap-3 lg:grid-cols-3">
                    {operationPolicies.map(([label, policy]) => (
                      <Collapsible key={label} title={label}>
                        <pre tabIndex={-1} aria-label={`${selected.label} ${label.toLowerCase()}`} className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs/5 font-normal text-[var(--sj-ink-soft)]">
                          {JSON.stringify(policy, null, 2)}
                        </pre>
                      </Collapsible>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {selected.kind === "redirect" ? (
              <div className="mt-5 grid gap-3 border-y border-[var(--sj-border)] py-5">
                <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Auth</p>
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  OAuth authorize is a browser navigation. It uses your real Spoonjoy login if you are signed in, or sends you through Spoonjoy login before consent. Playground auth mode is not sent on this redirect.
                </p>
              </div>
            ) : (
            <div className="mt-5 grid gap-3 border-y border-[var(--sj-border)] py-5">
              <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Auth</p>
              <SegmentedControl
                label="Authentication mode"
                hideLabel
                fullWidth
                items={visibleAuthModes.map(({ id, label }) => ({ value: id, label }))}
                value={authMode}
                onValueChange={(value) => selectAuthMode(value as PlaygroundAuthMode)}
              />
              <p className="text-sm/6 text-[var(--sj-ink-soft)]">{authCopy(authMode, isAuthenticated)}</p>
              {/* istanbul ignore next -- @preserve auth mode state is constrained by generated credentialModes and reset on operation changes. */ !authModeAllowed ? (
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  This operation does not support the selected auth mode.
                </p>
              ) : null}
              {bearerError ? (
                <p className="border-l-2 border-[var(--sj-tomato)] pl-3 text-sm/6 text-[var(--sj-ink-soft)]">
                  {bearerError}
                </p>
              ) : null}
              {authMode === "session" ? (
                isAuthenticated ? (
                  <p className="inline-flex items-start gap-2 text-sm/6 text-[var(--sj-ink-soft)]">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sj-brass)]" aria-hidden="true" />
                    <span>Signed in to Spoonjoy. Session requests will include your browser login.</span>
                  </p>
                ) : (
                  <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                    Session mode is browser-only. If a private request returns 401, sign in and come back to the same operation.
                    {" "}
                    <Link
                      href="/login?redirectTo=/api/playground"
                      onClick={() => capturePlaygroundTelemetry("spoonjoy.developer.playground.sign_in_clicked", {
                        auth_mode: "session",
                      }, selected)}
                    >
                      Sign in
                    </Link>
                  </p>
                )
              ) : null}
              {authMode === "anonymous" && isAuthenticated ? (
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  You are signed in, but Anonymous mode intentionally omits your Spoonjoy session for this request.
                </p>
              ) : null}
              {authMode === "bearer" ? (
                <div className="grid gap-2">
                  <TextField
                    label="Bearer token"
                    hideLabel
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder="sj_..."
                  />
                  <div>
                    <Button
                      plain
                      startIcon={KeyRound}
                      onClick={() => {
                        setAuthMode("session");
                        selectOperation("POST /api/v1/tokens");
                      }}
                    >
                      Create a token with Session auth
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            )}

            {selected.params.length ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
	                {selected.params.map((param) => {
	                  const fieldId = `param-${param.in}-${param.name}`;
	                  const isMissing = param.required && !params[param.name]?.trim();
	                  return (
                    <TextField
                      key={`${param.in}-${param.name}`}
                      id={fieldId}
                      label={param.label}
                      value={params[param.name]}
                      onChange={(event) => updateParam(param.name, event.target.value)}
                      placeholder={param.placeholder}
                      required={param.required}
                      aria-invalid={isMissing}
                      description={
                        <span className="font-mono">
                          {param.in}{param.required ? " required" : ""}
                          {param.description ? ` - ${param.description}` : ""}
                          {isMissing ? " - fill this before sending" : ""}
                        </span>
                      }
                    />
	                  );
	                })}
              </div>
            ) : null}
            {hasHeaderMutationId ? (
              <div className="mt-3">
                <Button plain startIcon={RefreshCw} onClick={() => updateParam("X-Client-Mutation-Id", freshMutationId(selected))}>
                  Fresh mutation id
                </Button>
              </div>
            ) : null}
            {missingParams.length ? (
              <p className="mt-4 border-l-2 border-[var(--sj-tomato)] pl-3 text-sm/6 text-[var(--sj-ink-soft)]">
                Set required parameters before sending. Generated URLs use REPLACE_* placeholders until you fill them.
              </p>
            ) : null}

            {selected.kind === "redirect" ? (
              <div className="mt-5 grid gap-3 border-y border-[var(--sj-border)] py-5">
                <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">PKCE helper</p>
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  Generate a verifier and state, store both in your client, and verify state after the callback before exchanging the code.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button plain startIcon={KeyRound} onClick={() => void generatePkce()}>
                    Generate PKCE + state
                  </Button>
                  {pkceVerifier ? <CopyButton value={`code_verifier=${pkceVerifier}\nstate=${params.state}\ncode_challenge=${params.code_challenge}`} label="Copy bundle" /> : null}
                </div>
                {pkceVerifier ? (
                  <pre tabIndex={-1} aria-label="PKCE and state bundle" className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-paper)] p-3 font-mono text-xs/5 font-normal text-[var(--sj-ink-soft)]">
                    {`code_verifier=${pkceVerifier}\nstate=${params.state}\ncode_challenge=${params.code_challenge}`}
                  </pre>
                ) : null}
                <TextField
                  label="OAuth callback URL"
                  value={oauthCallbackUrl}
                  onChange={(event) => setOauthCallbackUrl(event.target.value)}
                  placeholder="https://example.com/oauth/callback?code=oac_...&state=state_..."
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button plain startIcon={RefreshCw} onClick={prepareOauthTokenExchange}>
                    Prepare token exchange
                  </Button>
                  {oauthCallbackStatus ? (
                    <p className="text-sm/6 text-[var(--sj-ink-soft)]">{oauthCallbackStatus}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {selected.requestBody ? (
              <div className="mt-5 grid gap-2 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {bodyLabel}
                  <span className="flex flex-wrap gap-2">
                    {hasBodyMutationId ? (
                      <Button plain size="sm" startIcon={RefreshCw} onClick={generateBodyMutationId}>
                        Fresh mutation id
                      </Button>
                    ) : null}
                    <CopyButton value={bodyText} label="Copy body" />
                  </span>
                </span>
                {selected.requestBody.examples.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.requestBody.examples.map((example) => (
                      <Button key={example.name} plain size="sm" onClick={() => updateBody(example.example)}>
                        {example.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {selected.requestBody.contentType === "multipart/form-data" ? (
                  <div className="grid gap-3">
                    {selected.requestBody.fields.map((field) => {
                      const fieldId = `multipart-${selected.operationId}-${field.name}`;
                      const isFileField = Boolean(field.accept);
                      const description = `${field.required ? "multipart required" : "multipart optional"}${field.description ? ` - ${field.description}` : ""}`;
                      return isFileField ? (
                        <FileField
                          key={field.name}
                          label={field.label}
                          accept={field.accept}
                          required={field.required}
                          description={description}
                          onFilesChange={(files) => updateMultipartFile(field.name, files[0] ?? null)}
                        />
                      ) : (
                        <TextField
                          key={field.name}
                          id={fieldId}
                          label={field.label}
                          value={multipartValues[field.name] ?? ""}
                          required={field.required}
                          description={description}
                          onChange={(event) => updateMultipartValue(field.name, event.currentTarget.value)}
                        />
                      );
                    })}
                    <pre tabIndex={-1} aria-label={bodyLabel} className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 py-3 font-mono text-sm/6 font-normal text-[var(--sj-ink-soft)]">
                      {bodyText}
                    </pre>
                  </div>
                ) : (
                  <TextArea
                    label={bodyLabel}
                    hideLabel
                    value={bodyText}
                    onChange={(event) => updateBody(event.target.value)}
                    spellCheck={false}
                    rows={10}
                  />
                )}
                {bodyError ? (
                  <p className="border-l-2 border-[var(--sj-tomato)] pl-3 text-sm/6 font-normal text-[var(--sj-ink-soft)]">
                    {bodyError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              <p className="break-words font-mono text-sm/6 text-[var(--sj-ink)]">
                <code className="rounded-sm border border-[var(--sj-border)] bg-[var(--sj-flour)] px-0.5 text-sm font-medium text-[var(--sj-ink)] sm:text-[0.8125rem]">{path}</code>
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={path} label="Copy path" />
                <CopyButton value={curl} label={authMode === "session" ? "Copy fetch" : "Copy curl"} />
              </div>
              <pre tabIndex={-1} aria-label={authMode === "session" ? "Generated browser fetch snippet" : "Generated curl command"} className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                {curl}
              </pre>
            </div>

            <div className="mt-5 grid gap-3 border-y border-[var(--sj-border)] py-5">
              <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Possible responses</p>
	              <div className="grid gap-2">
	                {selected.responseSummaries.map((summary) => (
                  <p key={`${selected.id}-${summary.status}`} className="text-sm/6 text-[var(--sj-ink-soft)]">
                    <span className="font-mono font-bold text-[var(--sj-ink)]">{summary.status}</span>
                    {" "}{summary.description}
	                  </p>
	                ))}
	              </div>
	              {selected.responseExamples.length ? (
	                <div className="mt-4 grid gap-3">
	                  <p className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Example payloads</p>
	                  {selected.responseExamples.map((example) => (
                    <Collapsible key={`${selected.id}-${example.status}-${example.name}`} title={`${example.status} ${example.label}`}>
	                      <pre tabIndex={-1} aria-label={`${selected.label} ${example.status} ${example.label} response example`} className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs/5 font-normal text-[var(--sj-ink-soft)]">
	                        {example.example}
	                      </pre>
                    </Collapsible>
	                  ))}
	                </div>
	              ) : null}
	            </div>

            {riskNeedsConfirmation ? (
              <div className="mt-5 border border-[var(--sj-tomato)] bg-[color-mix(in_srgb,var(--sj-tomato)_8%,var(--sj-paper))] p-4">
                <Checkbox
                  label="I understand this request can change real Spoonjoy data, revoke/create credentials, or reveal a secret token."
                  checked={confirmedRisk}
                  onCheckedChange={setConfirmedRisk}
                />
              </div>
            ) : null}

            {validationErrors.length ? (
              <div id="playground-validation-errors" role="alert" className="mt-5 grid gap-1 border-l-2 border-[var(--sj-tomato)] pl-3">
	                {validationErrors.map((error) => (
	                  <p key={error} className="text-sm/6 text-[var(--sj-ink-soft)]">{error}</p>
	                ))}
	                {missingParams.map((param) => (
	                  <p key={`missing-${param.name}`} className="text-sm/6 text-[var(--sj-ink-soft)]">{param.label} is required.</p>
	                ))}
	              </div>
            ) : null}

            <div className="mt-5">
              <Button type="submit" disabled={!canSend} aria-describedby={validationId}>
                <Play data-slot="icon" aria-hidden="true" />
                {selected.kind === "redirect" ? "Open authorization URL" : isSending ? "Sending" : "Send request"}
              </Button>
            </div>
          </div>

	          <section className="border border-[var(--sj-border-strong)] bg-[var(--sj-photo-charcoal)] p-5 text-[var(--sj-on-photo)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CookbookSectionTitle className="my-0 text-[var(--sj-on-photo)]">Response</CookbookSectionTitle>
              {response ? (
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton value={response.body} label="Copy response" />
                  <span className="inline-flex items-center gap-2 font-sj-ui text-sm font-semibold">
                    {response.status >= 200 && response.status < 300 ? (
                      <CheckCircle2 className="size-4 text-[var(--sj-on-photo-warm)]" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-4 text-[var(--sj-tomato)]" aria-hidden="true" />
                    )}
                    {response.status} {response.statusText}
                  </span>
                </div>
              ) : null}
	            </div>
	            <p className="sr-only" aria-live="polite">
	              {response ? `Response ${response.status} ${response.statusText}${response.requestId ? `, request id ${response.requestId}` : ""}` : ""}
	            </p>
	            {response?.requestId ? (
              <p className="mt-3 font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">Request ID: {response.requestId}</p>
            ) : null}
            {response?.headers.length ? (
              <div className="mt-3 grid gap-1">
                {response.headers.map((header) => (
                  <p key={`${header.name}-${header.value}`} className="break-words font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">
                    {header.name}: {header.value}
                  </p>
                ))}
              </div>
            ) : null}
            {response?.method && response.path ? (
              <p className="mt-2 break-words font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">
                {response.method} {response.path}
                {" - "}{response.elapsedMs} ms
              </p>
            ) : null}
            {response?.secrets?.length ? (
              <div className="mt-4 border border-[var(--sj-on-photo-muted)] p-3">
                <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-on-photo-warm)]">
                  Secret values hidden in response body
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
	                  {response.secrets.map((secret, index) => (
	                    <CopyButton key={`${secret.label}-${index}`} value={secret.value} label={`Copy hidden ${secret.label} value`} />
	                  ))}
                  <Button plain size="sm" onClick={() => setResponse(null)}>
                    Clear response
                  </Button>
                </div>
              </div>
            ) : null}
            <pre tabIndex={-1} aria-label="Response body" className="mt-4 min-h-64 overflow-x-auto whitespace-pre-wrap font-mono text-xs/5 text-[var(--sj-on-photo-muted)]">
              {response ? response.body : "No response yet."}
            </pre>
          </section>
        </section>

        <section aria-label="Operations" className="grid content-start gap-5 pr-1 xl:max-h-[46rem] xl:overflow-y-auto">
          <TextField
            label="Search operations"
            type="search"
            value={operationQuery}
            onChange={(event) => setOperationQuery(event.target.value)}
            placeholder="recipe, token, sync..."
            startAdornment={<Search aria-hidden="true" />}
          />
          {filteredOperations.length === 0 ? (
            <Empty title="No operations match this surface and search." />
          ) : null}
          {operationGroups.map((group) => (
            <div key={group.tag} className="grid gap-2">
              <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">{group.tag}</p>
              {/* TODO(ouro-hx: choice-card): Picking an operation becomes HX's choice card (a radio group of cards) once it ships. */}
              {group.operations.map((operation) => (
                <button
                  key={operation.id}
                  type="button"
                  aria-label={`${operation.method} ${operation.path}: ${operation.label}`}
                  aria-pressed={operation.id === selected.id}
	                  onClick={() => selectOperation(operation.id, { focusBuilder: true })}
                  className={`grid gap-2 border p-4 text-left transition ${
                    operation.id === selected.id
                      ? "border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-brass)_12%,var(--sj-panel-solid))]"
                      : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)] hover:border-[var(--sj-border-strong)]"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-sj-ui text-sm/5 font-bold text-[var(--sj-ink)]">{operation.label}</span>
                    <Badge tone={methodColor(operation.method)} variant="soft">
                      {operation.method}
                    </Badge>
                  </span>
                  <span className="break-words font-mono text-xs/5 text-[var(--sj-ink-soft)]">{operation.path}</span>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={riskColor(operation.risk)} variant="soft">{operation.risk}</Badge>
                    {operation.credentialModes.map((mode) => <Badge key={mode} variant="soft">{mode}</Badge>)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>
      </form>

      <section className="grid gap-4 border-t border-[var(--sj-border-strong)] py-6 lg:grid-cols-3">
        {manifest.clientScenarios.map((scenario) => (
          <article key={scenario.id} className="grid content-start gap-3 border-y border-[var(--sj-border)] py-5">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              {scenario.eyebrow}
            </p>
            <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{scenario.title}</h2>
            <p className="text-sm/6 text-[var(--sj-ink-soft)]">{scenario.audience}</p>
            <ul className="grid gap-1 text-sm/6 text-[var(--sj-ink-soft)]">
              {scenario.notes.map((note) => <li key={note}>- {note}</li>)}
            </ul>
            <pre tabIndex={-1} aria-label={`${scenario.title} sample`} className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
              {scenario.sample}
            </pre>
            <div>
	              <CopyButton value={scenario.sample} label={`Copy ${scenario.title} sample`} />
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 border-t border-[var(--sj-border-strong)] py-6 lg:grid-cols-3">
        {manifest.authFlows.map((flow) => (
          <article key={flow.title} className="grid content-start gap-3 border-y border-[var(--sj-border)] py-5">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              {flow.eyebrow}
            </p>
            <h2 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{flow.title}</h2>
            <p className="text-sm/6 text-[var(--sj-ink-soft)]">{flow.audience}</p>
            <ul className="grid gap-1 text-sm/6 text-[var(--sj-ink-soft)]">
              {flow.notes.map((note) => <li key={note}>- {note}</li>)}
            </ul>
            <pre tabIndex={-1} aria-label={`${flow.title} sample`} className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
              {flow.sample}
            </pre>
            <div>
	              <CopyButton value={flow.sample} label={`Copy ${flow.title} sample`} />
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-6 border-t border-[var(--sj-border-strong)] py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <CookbookSectionTitle className="my-0">OAuth Scope Mapping</CookbookSectionTitle>
          <div className="mt-4 grid gap-3">
            {Object.entries(manifest.oauthScopeMap).map(([oauthScope, restScopes]) => (
              <div key={oauthScope} className="border-b border-[var(--sj-border)] pb-3">
                <p className="font-mono text-sm font-bold text-[var(--sj-ink)]">{oauthScope}</p>
                <p className="mt-1 font-mono text-xs/5 text-[var(--sj-ink-soft)]">{restScopes.join(" + ")}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <CookbookSectionTitle className="my-0">Current API Boundary</CookbookSectionTitle>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Available now</p>
              <ul className="mt-2 grid gap-1 text-sm/6 text-[var(--sj-ink-soft)]">
                {manifest.currentCapabilities.available.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Not in v1 yet</p>
              <ul className="mt-2 grid gap-1 text-sm/6 text-[var(--sj-ink-soft)]">
                {manifest.currentCapabilities.notYetAvailable.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </CookbookPage>
  );
}
