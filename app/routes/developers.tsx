import { useLoaderData } from "react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { usePostHog } from "@posthog/react";
import {
  Activity,
  BookOpen,
  Braces,
  KeyRound,
  Link as LinkIcon,
  Play,
  RefreshCw,
  ShieldCheck,
  LogIn,
  ShoppingBasket,
} from "lucide-react";
import { API_V1_ERROR_STATUS, API_V1_RESOURCES, API_V1_SCOPE_REQUIREMENTS } from "~/lib/api-v1-contract.server";
import { captureSafeClientEvent } from "~/lib/analytics";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, PAGE_OG_CARDS, absoluteUrlFromPreferredBase, pageOgPath } from "~/lib/og-metadata";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";

const DEVELOPER_SCOPES = [
  "public:read",
  "kitchen:read",
  "kitchen:write",
  "recipes:read",
  "cookbooks:read",
  "shopping_list:read",
  "shopping_list:write",
  "tokens:read",
  "tokens:write",
] as const;

const DEVELOPER_OG_CARD = PAGE_OG_CARDS.api;
const DEVELOPER_CANONICAL_PATH = "/api";
const DEVELOPER_OG_PATH = pageOgPath("api");

const scopeLabels: Record<string, string> = {
  "public:read": "Public read",
  "kitchen:read": "Delegated kitchen read",
  "kitchen:write": "Delegated kitchen write",
  "recipes:read": "Recipe graph read",
  "cookbooks:read": "Cookbook graph read",
  "shopping_list:read": "Shopping list read",
  "shopping_list:write": "Shopping list write",
  "tokens:read": "Token metadata read",
  "tokens:write": "Bearer credential create and revoke",
};

const authModels = [
  {
    title: "Spoonjoy session",
    body: "Best for the playground and same-origin browser clients. Sign in once; your login is the credential for private API calls.",
    icon: LogIn,
  },
  {
    title: "Bearer credentials",
    body: "Best only when a client runs outside the Spoonjoy browser session. The token API is exposed as part of the generated surface.",
    icon: KeyRound,
  },
  {
    title: "OAuth/PKCE apps",
    body: "Best for third-party apps. Dynamic registration, authorize, and token routes are exposed for delegated consent.",
    icon: ShieldCheck,
  },
  {
    title: "MCP clients",
    body: "Best for assistant-style clients that need a tool connection instead of raw REST calls.",
    icon: LinkIcon,
  },
  {
    title: "Delegated and device-style authorization",
    body: "Best for clients that need a chef to approve access from a constrained device or external runtime.",
    icon: Activity,
  },
] as const;

const clientProfiles = [
  { title: "Tiny-device clients", href: "#scenario-quickstarts", body: "Use sync cursors, small payloads, and idempotent retries when a device is offline or battery constrained." },
  { title: "Mobile apps", href: "#oauth-and-delegated-flows", body: "Read public recipes without auth, then request shopping-list scopes only after a chef connects their account." },
  { title: "CLI/script clients", href: "#terminal-quickstart", body: "Use bearer credentials, curl, and OpenAPI JSON only when the script cannot share a Spoonjoy session." },
  { title: "Browser clients", href: "#auth-implementation", body: "Use same-origin Session only inside spoonjoy.app. Extensions and third-party browser apps use OAuth/PKCE." },
  { title: "Agent clients", href: "#oauth-and-delegated-flows", body: "Use MCP or delegated connection endpoints when a chef needs to approve an assistant-style runtime." },
  { title: "Enterprise clients", href: "#current-api-boundary", body: "API v1 is individual delegated access today; there are no tenant, admin, employee, or org-export APIs yet." },
] as const;

const terminalQuickstart = [
  "export SJ_BASE='https://spoonjoy.app'",
  "umask 077",
  "state_dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/spoonjoy.XXXXXX\")\"",
  "trap 'rm -rf \"$state_dir\"' EXIT",
  "",
  "curl -fsS \"$SJ_BASE/api/v1/health\" | jq",
  "curl -fsS \"$SJ_BASE/api/v1/recipes?query=pasta&limit=5\" \\",
  "  | jq -r '.data.recipes[] | [.id, .title] | @tsv'",
  "",
  "# Public catalog calls omit Authorization. Use the delegated token below",
  "# for private shopping-list calls, not for every public recipe request.",
  "# First external shopping-list token without browser cookies: delegated approval",
  "curl -fsS \"$SJ_BASE/api/tools/start_agent_connection\" \\",
  "  -H 'Content-Type: application/json' \\",
  "  --data '{\"agentName\":\"Kitchen CLI\",\"scopes\":\"shopping_list:read shopping_list:write\"}' \\",
  "  > \"$state_dir/start.json\"",
  "",
  "jq -r '.data.authorizationUrl' \"$state_dir/start.json\"",
  "jq -r '.data.verificationUri' \"$state_dir/start.json\"",
  "jq -r '.data.userCode' \"$state_dir/start.json\"",
  "jq -r '.data.deviceCode' \"$state_dir/start.json\"",
  "",
  "while :; do",
  "  curl -fsS \"$SJ_BASE/api/tools/poll_agent_connection\" \\",
  "    -H 'Content-Type: application/json' \\",
  "    --data \"{\\\"deviceCode\\\":\\\"$(jq -r '.data.deviceCode' \"$state_dir/start.json\")\\\"}\" \\",
  "    > \"$state_dir/poll.json\"",
  "  status=\"$(jq -r '.data.status' \"$state_dir/poll.json\")\"",
  "  test \"$status\" = approved && break",
  "  if test \"$status\" != pending; then",
  "    jq . \"$state_dir/poll.json\" >&2",
  "    echo \"Connection status is $status; start a new delegated approval request if you still need access.\" >&2",
  "    exit 1",
  "  fi",
  "  sleep \"$(jq -r '.data.interval // 2' \"$state_dir/start.json\")\"",
  "done",
  "",
  "export SPOONJOY_TOKEN=\"$(jq -r '.data.token' \"$state_dir/poll.json\")\"",
].join("\n");

const externalGuideSteps = [
  {
    title: "Read the public Chef graph",
    scope: "No token required",
    body: "Start with GET /api/v1/recipes and GET /api/v1/cookbooks. Public graph reads do not require Authorization: Bearer, and the OpenAPI contract is available at /api/v1/openapi.json.",
    sample: "curl 'https://spoonjoy.app/api/v1/recipes?query=pasta&limit=20'\ncurl 'https://spoonjoy.app/api/v1/cookbooks?limit=20'",
  },
  {
    title: "Use your Spoonjoy session",
    scope: "Requires login",
    body: "Sign into Spoonjoy, open the playground, and leave auth on Session. There is no token to mint or paste for playground calls; the browser sends your normal Spoonjoy session cookie, and private endpoints treat that as the authenticated chef.",
    sample: "https://spoonjoy.app/api/playground",
  },
  {
    title: "Use bearer only outside the session",
    scope: "External clients",
    body: "Bearer mode is for clients that cannot use the logged-in Spoonjoy browser session. The generated POST /api/v1/tokens operation is available in the playground because it is part of API v1, not because private playground calls need a separate token.",
    sample: "Playground auth: Session\nGenerated operation: POST /api/v1/tokens\nUse the returned sj_... secret only in an external client or Bearer-mode test.",
  },
  {
    title: "Sync a private shopping list",
    scope: "Requires shopping_list:read",
    body: "Use GET /api/v1/shopping-list/sync with an opaque cursor to fetch active rows and deletion records for removed rows. Omit cursor on the first request, then store nextCursor only after your client applies the whole response.",
    sample: "curl -fsS 'https://spoonjoy.app/api/v1/shopping-list/sync' \\\n  -H 'Authorization: Bearer sj_client_token'",
  },
  {
    title: "Perform an idempotent shopping-list mutation",
    scope: "Requires shopping_list:write",
    body: "Use POST /api/v1/shopping-list/items with clientMutationId so retries can replay the same write without duplicating items.",
    sample: "curl -fsS -X POST 'https://spoonjoy.app/api/v1/shopping-list/items' \\\n  -H 'Authorization: Bearer sj_client_token' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"clientMutationId\":\"device-uuid-1\",\"name\":\"Eggs\",\"quantity\":12,\"unit\":\"Each\"}'",
  },
] as const;

const tokenAcquisitionPaths = [
  {
    title: "No token: signed-in browser",
    mode: "Same-origin",
    body: "A same-origin browser client does not fetch or store a bearer token. The chef signs into Spoonjoy with password, passkey, or any configured Google, GitHub, or Apple provider, and private API calls use the resulting session cookie. Those provider buttons are Spoonjoy sign-in methods, not OAuth providers that your client owns.",
    sample: "Login surface: /login\nThen call: fetch(\"/api/v1/shopping-list\", { credentials: \"same-origin\" })",
  },
  {
    title: "Personal token: signed-in chef creates one",
    mode: "Direct token",
    body: "For a script, device, or developer-owned client, the chef signs in first and runs POST /api/v1/tokens from Session auth, such as through the generated playground. An existing bearer credential with tokens:write can also create another token, but never with broader scopes than it already has. Spoonjoy returns the raw sj_... secret once; save it outside browser bundles.",
    sample: "POST /api/v1/tokens\nAuth: Session cookie or Bearer sj_... with tokens:write\nBody: { \"name\": \"Kitchen script\", \"scopes\": [\"recipes:read\", \"cookbooks:read\", \"shopping_list:read\", \"shopping_list:write\"] }\nResponse: { \"ok\": true, \"data\": { \"token\": \"sj_...\", \"credential\": { \"id\": \"cred_...\", \"scopes\": [...] } } }",
  },
  {
    title: "Delegated token: OAuth/PKCE",
    mode: "Third-party",
    body: "For a third-party app, register a public client and redirect the chef to /oauth/authorize. If they are not signed in, Spoonjoy routes them through /login and the full auth surface before consent. The client never handles the chef's password. The client exchanges the authorization code at /oauth/token for an sj_... access_token plus rotating refresh_token.",
    sample: "POST /oauth/register -> client_id: cm_client_id_from_register\nGET /oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=...&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256\nPOST /oauth/token -> access_token: sj_...\nPOST /oauth/revoke -> revoke refresh_token and matching live OAuth access credentials",
  },
  {
    title: "Delegated token: approval link",
    mode: "Agent/device",
    body: "For clients that cannot run a browser-based OAuth callback, call POST /api/tools/start_agent_connection, show the authorizationUrl or stable verificationUri plus userCode to the chef, then poll POST /api/tools/poll_agent_connection no faster than the returned interval. Pass scopes for least privilege, such as shopping_list:read shopping_list:write; omitted scopes default to the same shopping-list read/write pair. The approval page also uses Spoonjoy's full login surface before issuing a one-time-display sj_... bearer token plus credential id. Personal and delegated bearer tokens do not expire unless expiresAt is non-null; rerun approval when a stored token returns 401 invalid_token. A device can revoke its own credential id with DELETE /api/v1/tokens/{credentialId}; revoking any other token requires tokens:write.",
    sample: "POST /api/tools/start_agent_connection -> verificationUri + verificationUriComplete + authorizationUrl + userCode + deviceCode + expiresIn: 600\nPOST /api/tools/poll_agent_connection -> status: pending | approved | denied | expired | claimed\nApproved response -> token: sj_... + credential metadata, including scopes and expiresAt",
  },
  {
    title: "No password-token API",
    mode: "Security",
    body: "Spoonjoy does not support an OAuth password grant or API endpoint where a third-party client trades a chef's password for a token. Email/password login creates a session cookie, not an API token. Clients should use OAuth/PKCE or delegated approval so Spoonjoy, not the client, handles password, passkey, and provider login.",
    sample: "Do not implement: grant_type=password\nUse instead: OAuth/PKCE or delegated approval link",
  },
] as const;

const authImplementationSteps = [
  {
    title: "Same-origin browser session",
    mode: "Browser",
    body: "After a chef signs in, your logged-in Spoonjoy session is the credential. Call relative /api/v1 URLs with credentials: \"same-origin\". Do not send Authorization; if an Authorization header is present, bearer auth wins over the session.",
    sample: "await fetch(\"/api/v1/shopping-list\", {\n  credentials: \"same-origin\",\n  headers: { \"X-Request-Id\": \"web-shopping-list\" },\n});",
  },
  {
    title: "External REST client",
    mode: "Bearer",
    body: "Use bearer only when a client cannot share the logged-in Spoonjoy session. In the playground, leave auth on Session and run the generated POST /api/v1/tokens operation, then store the sj_... secret outside browser bundles. Bearer-created tokens inherit the caller's scopes by default. Bearer callers cannot create a token with broader scopes than they already have.",
    sample: "curl 'https://spoonjoy.app/api/v1/shopping-list' \\\n  -H 'Authorization: Bearer sj_client_token' \\\n  -H 'X-Request-Id: client-shopping-list'",
  },
  {
    title: "OAuth/PKCE app",
    mode: "Delegated",
    body: "Register a public client with token_endpoint_auth_method: none and no client secret, redirect the chef through consent, then exchange the single-use 60-second code with a form-encoded POST /oauth/token request. Registration accepts common RFC 7591/OIDC metadata, but Spoonjoy stores only client_name and exact redirect_uris today. Optional scope metadata can be validated at registration, but the authorize request scope is the grant. Use a 43-128 character high-entropy PKCE verifier, S256 code challenge, and state. If the chef is not signed in, Spoonjoy routes them through /login first, where password, passkey, and configured Google, GitHub, or Apple sign-in all return to consent. OAuth accepts kitchen scopes plus least-privilege public, recipe, cookbook, and shopping-list scopes. The returned sj_... access_token lasts 15 minutes (expires_in: 900), refresh_token rotates on every refresh grant, and POST /oauth/revoke disconnects the stored refresh token plus live OAuth access credentials for that client/resource.",
    sample: "POST /oauth/register\nResponse: { \"client_id\": \"cm_client_id_from_register\" }\nGET /oauth/authorize?client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&response_type=code&scope=shopping_list%3Aread+shopping_list%3Awrite&state=...&code_challenge=...&code_challenge_method=S256\nPOST /oauth/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&client_id=...&redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback&code=...&code_verifier=...\n\nPOST /oauth/revoke\ntoken=ort_...&client_id=cm_client_id_from_register&token_type_hint=refresh_token",
  },
  {
    title: "Auth failures",
    mode: "Errors",
    body: "Treat authentication_required and invalid_token as 401 responses, insufficient_scope as 403, and malformed Authorization headers as validation_error. Public endpoints can be anonymous; Omit `Authorization` on public calls unless you require authenticated behavior. If you send credentials to an optional endpoint, Spoonjoy validates them and checks scopes. Log requestId or X-Request-Id for support.",
    sample: "{\n  \"ok\": false,\n  \"requestId\": \"client-shopping-list\",\n  \"error\": { \"code\": \"insufficient_scope\", \"status\": 403 }\n}",
  },
] as const;

const guideSteps = [
  "Read public recipes and cookbooks anonymously before adding auth.",
  "Use Session for logged-in playground calls; use bearer or OAuth only when a client runs outside that session.",
  "Use a stable mutation id for shopping-list writes, then retry with the same value when a network call is interrupted.",
  "Use the sync cursor to fetch shopping-list changes, including removed items.",
] as const;

const guideSections = [
  "Terminal Quickstart",
  "Current API Boundary",
  "External Client Guide",
  "Client Starting Points",
  "Token Acquisition",
  "Auth Implementation",
  "Response Protocols",
  "OAuth And Delegated Flows",
  "OAuth Scope Mapping",
  "Scenario Quickstarts",
  "Reference",
  "Scopes",
  "Auth",
  "Sync And Safety",
] as const;

function sectionId(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const syncSafetyRows = [
  ["Cursor", "Use the returned nextCursor as the next request cursor after applying every item in the page durably. Treat it as opaque; ISO timestamps are accepted only as a bootstrap convenience."],
  ["Tombstones", "Sync includes deleted rows with deletedAt so offline clients can remove local items."],
  ["Pagination", "Use limit from 1 to 50 for small payloads. hasMore: true means continue with the returned nextCursor; webhooks, REST Hooks, SSE, and event subscriptions are not available yet."],
  ["Idempotent shopping-list mutations", "clientMutationId is scoped to the chef, retained for 24 hours, and bound to method, path, and body hash. Persist and retry the exact serialized body for that mutation id."],
  ["Replay", "Retry the same request with the same clientMutationId after a timeout; Spoonjoy returns the recorded response with mutation.replayed: true."],
  ["Conflict", "Reusing the same clientMutationId for a different method, path, or body returns 409 idempotency_conflict."],
  ["Retries", "Retry network timeouts, 429, and 5xx responses with the same mutation id. Refresh or reconnect on 401. Do not retry validation, scope, or idempotency conflicts unchanged."],
] as const;

const scenarioQuickstarts = [
  {
    title: "Native mobile OAuth",
    mode: "iOS + Android",
    body: "Register once per app install or environment, persist client_id, and do not register on every launch. Use HTTPS universal links or Android App Links for production callbacks, with localhost or 127.0.0.1 loopback only for development. Store tokens in Keychain or Android Keystore-backed storage. Refresh tokens rotate, so replace the stored refresh token atomically and use single-flight refresh when concurrent requests hit 401.",
    sample: "POST /oauth/register\n{ \"client_name\": \"Grocery helper\", \"redirect_uris\": [\"https://example.com/spoonjoy/oauth/callback\"], \"token_endpoint_auth_method\": \"none\" }\n\nGET /oauth/authorize?...&state=client_state&code_challenge=pkce_s256&scope=shopping_list:read+shopping_list:write\n\nPOST /oauth/token\ngrant_type=authorization_code&client_id=cm_client_id_from_register&redirect_uri=https%3A%2F%2Fexample.com%2Fspoonjoy%2Foauth%2Fcallback&code=oac_...&code_verifier=pkce_verifier_...\n\nPOST /oauth/token\ngrant_type=refresh_token&client_id=cm_client_id_from_register&refresh_token=ort_...\n\nGET /api/v1/shopping-list/sync?limit=50",
  },
  {
    title: "Browser extension OAuth",
    mode: "Extension",
    body: "API v1 does not create or import recipes yet; the supported extension story today is shopping-list ingredient sync. Run OAuth/PKCE in the extension background, persist client_id plus state and code_verifier until callback, verify state, and make bearer API calls from the background instead of a content script. Register the HTTPS callback from chrome.identity.getRedirectURL/launchWebAuthFlow exactly; custom extension schemes are rejected.",
    sample: "const item = { sourceRowId: \"row-42\", name: \"Eggs\", quantity: 12, unit: \"Each\" }\nclientMutationId = `extension:${sha256(recipeUrl)}:${item.sourceRowId}:${bodyHash}`\nPOST /api/v1/shopping-list/items\nAuthorization: Bearer sj_...\n{ \"clientMutationId\": \"extension:...\", \"name\": \"Eggs\", \"quantity\": 12, \"unit\": \"Each\" }",
  },
  {
    title: "Cron shopping-list export/import",
    mode: "CLI/script",
    body: "Omit cursor on the first sync, then store data.nextCursor after applying every item and tombstone. Use limit for small payloads and keep fetching while hasMore is true. Import with deterministic chef-wide mutation ids such as shopping-import:<source-system>:<source-row-id>:<body-hash>; this is not a durable set-desired-state API after the 24-hour idempotency window.",
    sample: "umask 077\ntmp_dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/spoonjoy-sync.XXXXXX\")\"\ntrap 'rm -rf \"$tmp_dir\"' EXIT\ncurl -fsS 'https://spoonjoy.app/api/v1/shopping-list/sync?limit=20' \\\n  -H 'Authorization: Bearer sj_...' > \"$tmp_dir/sync.json\"\njq -n --arg cursor \"$(jq -r '.data.nextCursor' \"$tmp_dir/sync.json\")\" '{cursor:$cursor}' > state.json",
  },
  {
    title: "Cloudflare Worker sync bridge",
    mode: "Serverless",
    body: "Store access_token, rotating refresh_token, and cursor state behind a Durable Object, queue-level serializer, or D1 row lock. KV is fine for read-through snapshots after the lock, but not as the refresh-token compare-and-set mechanism. Respect Retry-After and never store authenticated bearer responses in caches.default.",
    sample: "Queue message: { chefId, mutation, clientMutationId }\nDurable Object per chef: refresh once, atomically store the rotated refresh_token, then retry queued mutations with the same clientMutationId.\nGET /api/v1/shopping-list/sync?limit=50\nAuthorization: Bearer sj_...",
  },
  {
    title: "No-code connector profile",
    mode: "Zapier + Make",
    body: "Import /api/v1/openapi.connector.json for an OpenAPI 3.0 REST-only profile. Configure OAuth as public client, no client secret, PKCE S256, authorization URL /oauth/authorize, token and refresh URL /oauth/token, revoke URL /oauth/revoke. API v1 has no webhooks yet; expose shopping-list sync as a polling trigger.",
    sample: "Trigger: New, updated, or removed shopping-list item\n1. GET /api/v1/shopping-list/sync?limit=50\n2. Sort returned rows by updatedAt descending for the no-code platform.\n3. Dedupe events by id:updatedAt so changed items are not suppressed.\n4. Treat deletedAt rows as removals or filtered tombstones.\n5. Persist nextCursor only after the run succeeds.",
  },
  {
    title: "Public BI snapshot export",
    mode: "Reporting",
    body: "Public recipe/cookbook lists use createdAt/id cursor walks. They are not repeatable snapshot guarantees or updatedAt incremental exports, and they do not include deletion tombstones; restart a full crawl when you need to catch public edits or removals. Preserve attribution, respect Retry-After, and do not treat public JSON as a photo-copying or commercial republication license.",
    sample: "snapshot_resource recipes recipes recipes.ndjson\nsnapshot_resource cookbooks cookbooks cookbooks.ndjson\n\nGET /api/v1/recipes?limit=50\nGET /api/v1/cookbooks?limit=50\nGET /api/v1/recipes?cursor=v1.cursor_from_nextCursor&limit=50\n\nAnonymous public responses may include Cache-Control: public, max-age=60, stale-while-revalidate=300 but not ETag or Last-Modified.",
  },
  {
    title: "Recipe blog embeds",
    mode: "REST-powered embeds only",
    body: "Fetch public JSON and render your own HTML with textContent, not innerHTML. Spoonjoy pages are not iframe embeds. Recipe steps are returned in ascending stepNum order, step duration is minutes when present, and ingredients are step-attached in API order. Validate sourceUrl as http/https before linking, write your own image alt text, and avoid copying photos where removals cannot be honored.",
    sample: "GET /api/v1/recipes/{id}\nIf 404 not_found, hide or replace the embed before rendering stale content.\nRender servings, step ingredients, ordered steps, and attribution.creditText as a link to attribution.canonicalUrl.\nIf attribution.sourceRecipe.deleted is true, credit it as unavailable instead of linking it.",
  },
] as const;

export function meta({ data }: { data?: { canonicalUrl?: string; ogImageUrl?: string } } = {}) {
  const canonicalUrl = data?.canonicalUrl ?? `https://spoonjoy.app${DEVELOPER_CANONICAL_PATH}`;
  const ogImageUrl = data?.ogImageUrl ?? `https://spoonjoy.app${DEVELOPER_OG_PATH}`;

  return [
    { title: `${DEVELOPER_OG_CARD.title} | Spoonjoy` },
    {
      name: "description",
      content: DEVELOPER_OG_CARD.description,
    },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: DEVELOPER_OG_CARD.title },
    { property: "og:description", content: DEVELOPER_OG_CARD.description },
    { property: "og:url", content: canonicalUrl },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
    { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: DEVELOPER_OG_CARD.title },
    { name: "twitter:description", content: DEVELOPER_OG_CARD.description },
    { name: "twitter:image", content: ogImageUrl },
  ];
}

export function loader(args?: { request?: Request; context?: { cloudflare?: { env?: Pick<Env, "SPOONJOY_BASE_URL"> | null } } }) {
  const requestUrl = args?.request?.url;
  const baseUrl = args?.context?.cloudflare?.env?.SPOONJOY_BASE_URL;

  return {
    resources: API_V1_RESOURCES,
    scopeRequirements: API_V1_SCOPE_REQUIREMENTS,
    errorStatus: API_V1_ERROR_STATUS,
    openapiUrl: "/api/v1/openapi.json",
    sdkOpenapiUrl: "/api/v1/openapi.sdk.json",
    connectorOpenapiUrl: "/api/v1/openapi.connector.json",
    scopes: [...DEVELOPER_SCOPES],
    authFlows: API_V1_PLAYGROUND_MANIFEST.authFlows,
    oauthScopeMap: API_V1_PLAYGROUND_MANIFEST.oauthScopeMap,
    currentCapabilities: API_V1_PLAYGROUND_MANIFEST.currentCapabilities,
    canonicalUrl: absoluteUrlFromPreferredBase({ requestUrl, baseUrl, path: DEVELOPER_CANONICAL_PATH }),
    ogImageUrl: absoluteUrlFromPreferredBase({ requestUrl, baseUrl, path: DEVELOPER_OG_PATH }),
  };
}

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "green" : method === "POST" ? "amber" : method === "PATCH" ? "blue" : "red";
  return <Badge color={color}>{method}</Badge>;
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={sectionId(title)} className="scroll-mt-6 border-t border-[var(--sj-border-strong)] py-8">
      <CookbookSectionTitle className="my-0">
        <a href={`#${sectionId(title)}`} className="underline decoration-transparent underline-offset-4 hover:decoration-[var(--sj-brass)]">
          {title}
        </a>
      </CookbookSectionTitle>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function scopeTone(scope: string) {
  if (scope.includes("write")) return "amber";
  if (scope.includes("tokens")) return "red";
  if (scope.includes("shopping")) return "green";
  return "zinc";
}

export default function Developers() {
  const { resources, scopeRequirements, errorStatus, openapiUrl, sdkOpenapiUrl, connectorOpenapiUrl, scopes, authFlows, oauthScopeMap, currentCapabilities } = useLoaderData<typeof loader>();
  const posthog = usePostHog();
  const docsViewTelemetrySent = useRef(false);

  useEffect(() => {
    if (docsViewTelemetrySent.current || !posthog) return;
    docsViewTelemetrySent.current = true;
    captureSafeClientEvent(posthog, "spoonjoy.developer.docs.viewed", {
      page: "api_docs",
      operation_count: API_V1_PLAYGROUND_MANIFEST.operations.length,
      auth_flow_count: authFlows.length,
      client_scenario_count: API_V1_PLAYGROUND_MANIFEST.clientScenarios.length,
    });
  }, [authFlows.length, posthog]);

  return (
    <CookbookPage className="sj-developer-page">
      <CookbookHeader eyebrow="API v1" title="Spoonjoy Developer Platform" action={(
        <div className="flex flex-wrap gap-2">
          <Button href="/api/playground">
            <Play data-slot="icon" aria-hidden="true" />
            Playground
          </Button>
          <Button href={openapiUrl} plain>
            <Braces data-slot="icon" aria-hidden="true" />
            Full Spec
          </Button>
          <Button href={sdkOpenapiUrl} plain>
            <Braces data-slot="icon" aria-hidden="true" />
            SDK Spec
          </Button>
          <Button href={connectorOpenapiUrl} plain>
            <Braces data-slot="icon" aria-hidden="true" />
            Connector Spec
          </Button>
        </div>
      )}>
        <Text className="text-lg/8">
          Build clients on Spoonjoy's public-by-default Chef graph, then add scoped auth only when a workflow needs private
          shopping-list state, token management, or delegated access.
        </Text>
      </CookbookHeader>

      <section className="grid gap-4 border-b border-[var(--sj-border-strong)] py-6 md:grid-cols-4">
        {[
          ["Version", "v1"],
          ["Base path", "REST v1"],
          ["Spec", "Machine-readable"],
          ["Errors", `${Object.keys(errorStatus).length} codes`],
        ].map(([label, value]) => (
          <div key={label} className="border-l border-[var(--sj-border)] pl-4">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">{label}</p>
            <p className="mt-1 break-words font-sj-display text-2xl/8 font-semibold text-[var(--sj-ink)]">{value}</p>
          </div>
        ))}
      </section>

      <nav aria-label="Developer guide sections" className="flex flex-wrap gap-2 border-b border-[var(--sj-border-strong)] py-4">
        {guideSections.map((section) => (
          <a
            key={section}
            href={`#${sectionId(section)}`}
            className="inline-flex min-h-9 items-center border border-[var(--sj-border)] px-3 font-sj-ui text-xs font-bold text-[var(--sj-ink)] underline decoration-transparent underline-offset-4 hover:border-[var(--sj-border-strong)] hover:decoration-[var(--sj-brass)]"
          >
            {section}
          </a>
        ))}
      </nav>

      <SectionShell title="Terminal Quickstart">
        <div className="grid gap-4 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
          <div>
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              curl + jq
            </p>
            <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">First successful calls</h3>
            <Text className="mt-3">
              Anonymous public reads work immediately. For the first external token, use delegated approval: the client shows an approval URL, the chef signs into Spoonjoy, and polling returns a one-time-display bearer token.
            </Text>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
            {terminalQuickstart}
          </pre>
        </div>
      </SectionShell>

      <SectionShell title="Current API Boundary">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Available now</p>
            <ul className="mt-3 grid gap-2 text-sm/6 text-[var(--sj-ink-soft)]">
              {currentCapabilities.available.map((item) => <li key={item}>- {item}</li>)}
            </ul>
          </div>
          <div>
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Not in v1 yet</p>
            <ul className="mt-3 grid gap-2 text-sm/6 text-[var(--sj-ink-soft)]">
              {currentCapabilities.notYetAvailable.map((item) => <li key={item}>- {item}</li>)}
            </ul>
            <Text className="mt-3">
              Corporate tenant/admin APIs, inventory, meal plans, full exports, canonical unit conversion, webhooks, REST Hooks, batch mutations, and recipe write/import/export endpoints are future API surface, not hidden current endpoints.
            </Text>
            <Text className="mt-3">
              Delegated approval helper endpoints under /api/tools/* are part of the current public connection flow. Other legacy app-only /api/* routes are not the external contract.
            </Text>
            <Text className="mt-3">
              Legacy /api/* routes reject OAuth access tokens that are audience-bound to /mcp. New external REST clients should use /api/v1/*.
            </Text>
          </div>
        </div>
      </SectionShell>

      <SectionShell title="External Client Guide">
        <div className="grid gap-6">
          <div className="border-y border-[var(--sj-border)] py-4">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              Client examples
            </p>
            <ul className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {clientProfiles.map((profile) => (
                <li key={profile.title} className="flex gap-3 text-sm/6 text-[var(--sj-ink-soft)]">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--sj-brass)]" aria-hidden="true" />
                  <span>
                    <a
                      href={profile.href}
                      className="font-sj-ui font-bold text-[var(--sj-ink)] underline decoration-[var(--sj-brass)] underline-offset-4"
                    >
                      {profile.title}
                    </a>
                    : {profile.body}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-4">
            {externalGuideSteps.map((step) => (
              <article
                key={step.title}
                className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]"
              >
                <div>
                  <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                    {step.scope}
                  </p>
                  <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{step.title}</h3>
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="text-sm/6 text-[var(--sj-ink-soft)]">{step.body}</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                    {step.sample}
                  </pre>
                </div>
              </article>
            ))}
          </div>
        </div>
      </SectionShell>

      <SectionShell title="Token Acquisition">
        <div className="grid gap-4">
          {tokenAcquisitionPaths.map((path) => (
            <article
              key={path.title}
              className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]"
            >
              <div>
                <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                  {path.mode}
                </p>
                <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{path.title}</h3>
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">{path.body}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                  {path.sample}
                </pre>
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Auth Implementation">
        <div className="grid gap-4">
          {authImplementationSteps.map((step) => (
            <article
              key={step.title}
              className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]"
            >
              <div>
                <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                  {step.mode}
                </p>
                <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{step.title}</h3>
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">{step.body}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                  {step.sample}
                </pre>
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Response Protocols">
        <div className="grid gap-4 md:grid-cols-2">
          <article className="border-y border-[var(--sj-border)] py-5">
            <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">API v1 REST response shape</h3>
            <Text className="mt-2">
              /api/v1 REST resources return ok, requestId, and data or error fields. Raw OpenAPI documents are the exception.
            </Text>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
              {`{ "ok": true, "requestId": "req_example", "data": {} }\n{ "ok": false, "requestId": "req_example", "error": { "code": "invalid_token", "status": 401 } }`}
            </pre>
          </article>
          <article className="border-y border-[var(--sj-border)] py-5">
            <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Protocol exceptions</h3>
            <Text className="mt-2">
              OAuth endpoints use OAuth token/error JSON except 429 rate limits, delegated /api/tools/* helpers use the legacy helper envelope, and /mcp uses JSON-RPC result/error objects.
            </Text>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
              {`OAuth: { "access_token": "sj_...", "refresh_token": "ort_..." }\nAgent helper: { "ok": true, "data": { "status": "pending" } }\nMCP: { "jsonrpc": "2.0", "result": {} }`}
            </pre>
          </article>
        </div>
      </SectionShell>

      <SectionShell title="OAuth And Delegated Flows">
        <Text className="mb-5">
          Browser clients may call /oauth/register, /oauth/token, and /oauth/revoke cross-origin; those endpoints answer OPTIONS with CORS headers.
          Cookie-authenticated API mutations remain same-origin session calls and should never rely on copied cookies in external clients.
        </Text>
        <Text className="mb-5">
          Do not request `offline_access` in OAuth authorize. OAuth clients can request kitchen scopes or least-privilege public, recipe, cookbook, and shopping-list scopes; refresh tokens are returned by the authorization-code flow.
        </Text>
        <div className="grid gap-4">
          {authFlows.map((flow) => (
            <article
              key={flow.id}
              className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]"
            >
              <div>
                <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                  {flow.eyebrow}
                </p>
                <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{flow.title}</h3>
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">{flow.audience}</p>
                <p className="break-words font-mono text-xs/5 text-[var(--sj-ink-soft)]">{flow.endpoints.join(" -> ")}</p>
                <ul className="grid gap-1 text-sm/6 text-[var(--sj-ink-soft)]">
                  {flow.notes.map((note) => <li key={note}>- {note}</li>)}
                </ul>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                  {flow.sample}
                </pre>
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="OAuth Scope Mapping">
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(oauthScopeMap).map(([oauthScope, restScopes]) => (
            <div key={oauthScope} className="border-b border-[var(--sj-border)] pb-4">
              <p className="font-mono text-sm font-bold text-[var(--sj-ink)]">{oauthScope}</p>
              <p className="mt-1 font-mono text-xs/5 text-[var(--sj-ink-soft)]">{restScopes.join(" + ")}</p>
            </div>
          ))}
        </div>
        <Text className="mt-4">
          OAuth clients may request the delegated scopes above directly. Token-management scopes remain personal-token or Session-only and are not granted by OAuth.
        </Text>
      </SectionShell>

      <SectionShell title="Scenario Quickstarts">
        <div className="grid gap-4">
          {scenarioQuickstarts.map((scenario) => (
            <article
              key={scenario.title}
              className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]"
            >
              <div>
                <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                  {scenario.mode}
                </p>
                <h3 className="mt-2 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{scenario.title}</h3>
              </div>
              <div className="min-w-0 space-y-3">
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">{scenario.body}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap border border-[var(--sj-border)] bg-[var(--sj-photo-charcoal)] p-4 font-mono text-xs/5 text-[var(--sj-on-photo)]">
                  {scenario.sample}
                </pre>
              </div>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Reference">
        <div className="grid gap-3">
          {resources.map((resource) => {
            const methodRows = resource.methods.map((method) => ({
              method,
              requirement: scopeRequirements.find((row) => row.path === resource.path && row.method === method),
            }));

            return (
              <article
                key={resource.name}
                data-testid={`developer-resource-${resource.name}`}
                className="grid gap-4 border-b border-[var(--sj-border)] py-4 lg:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)_minmax(12rem,18rem)]"
              >
                <div>
                  <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
                    {resource.name}
                  </p>
                  <p className="mt-1 break-words font-sj-ui text-sm/6 font-semibold text-[var(--sj-ink)]">{resource.path}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {methodRows.map(({ method, requirement }) => (
                    <span key={method} className="inline-flex items-center gap-2">
                      <MethodBadge method={method} />
                      {requirement?.scopes.length ? (
                        requirement.scopes.map((scope) => (
                          <Badge key={scope} color={scopeTone(scope) as "amber" | "green" | "red" | "zinc"}>
                            {scope}
                          </Badge>
                        ))
                      ) : (
                        <Badge>Anonymous</Badge>
                      )}
                    </span>
                  ))}
                </div>
                <p className="text-sm/6 text-[var(--sj-ink-soft)]">
                  {resource.auth === "bearer" ? "Authenticated chef surface." : "Anonymous callers allowed; authenticated callers are scope checked."}
                </p>
              </article>
            );
          })}
        </div>
      </SectionShell>

      <SectionShell title="Scopes">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scopes.map((scope) => (
            <div key={scope} className="border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_70%,transparent)] p-4">
              <p className="font-sj-ui text-sm/5 font-bold text-[var(--sj-ink)]">
                {scope}
              </p>
              <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{scopeLabels[scope]}</p>
            </div>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Auth">
        <div className="grid gap-4 md:grid-cols-2">
          {authModels.map(({ title, body, icon: Icon }) => (
            <article key={title} className="border-y border-[var(--sj-border)] py-5">
              <Icon className="size-5 text-[var(--sj-brass)]" aria-hidden="true" />
              <h3 className="mt-3 font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">{title}</h3>
              <Text className="mt-2">{body}</Text>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell title="Sync And Safety">
        <Text className="mb-5">
          Recipe and cookbook lists are public catalog search endpoints today. The query parameter wins when both query and q are supplied;
          lists include cursor, nextCursor, hasMore, cover images, canonicalUrl, and attribution fields. Owner export and deleted recipe tombstones are not in API v1 yet.
        </Text>
        <Text className="mb-5">
          Shopping-list cursor sync is the current incremental owner-data path. Store nextCursor after applying each batch and retry mutations with stable clientMutationId values.
        </Text>
        <Text className="mb-5">
          Recipe ingredient quantities, units, servings, temperatures, and timers are original author data in API v1. Units are free-form display strings,
          not a canonical conversion model; there is no /api/v1/units registry or density table yet.
        </Text>
        <Text className="mb-5">
          API v1 is rate limited by IP and credential before authentication work. Rate-limited responses return 429 and Retry-After; configured limits are edge abuse protection, not a globally precise quota meter.
        </Text>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <div className="grid gap-3">
            {syncSafetyRows.map(([label, body]) => (
              <div key={label} className="border-b border-[var(--sj-border)] pb-3">
                <p className="font-sj-ui text-sm/5 font-bold text-[var(--sj-ink)]">{label}</p>
                <p className="mt-1 text-sm/6 text-[var(--sj-ink-soft)]">{body}</p>
              </div>
            ))}
          </div>
          <div className="border border-[var(--sj-border-strong)] bg-[var(--sj-photo-charcoal)] p-5 text-[var(--sj-on-photo)]">
            <ShoppingBasket className="size-5 text-[var(--sj-on-photo-warm)]" aria-hidden="true" />
            <p className="font-sj-ui mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-on-photo-muted)]">
              Sample flow
            </p>
            <ol className="mt-3 space-y-3 text-sm/6 text-[var(--sj-on-photo-muted)]">
              {guideSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </div>
      </SectionShell>

      <SectionShell title="Client Starting Points">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Public catalog", "GET /api/v1/recipes and GET /api/v1/cookbooks need no token.", BookOpen],
            ["Private list", "Use shopping-list read and write scopes for pantry-style clients.", RefreshCw],
            ["Machine errors", "Every v1 error returns ok false, requestId, code, message, and status.", Braces],
          ].map(([title, body, Icon]) => (
            <article key={title as string} className="border-t border-[var(--sj-border)] pt-4">
              <Icon className="size-5 text-[var(--sj-brass)]" aria-hidden="true" />
              <h3 className="mt-3 font-sj-display text-xl/7 font-semibold text-[var(--sj-ink)]">{title as string}</h3>
              <Text className="mt-1">{body as string}</Text>
            </article>
          ))}
        </div>
      </SectionShell>
    </CookbookPage>
  );
}
