import { useLoaderData } from "react-router";
import type { ReactNode } from "react";
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
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Code, Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, CookbookSectionTitle } from "~/components/cookbook/page";

const DEVELOPER_SCOPES = [
  "public:read",
  "recipes:read",
  "cookbooks:read",
  "shopping_list:read",
  "shopping_list:write",
  "tokens:read",
  "tokens:write",
  "offline_access",
] as const;

const scopeLabels: Record<string, string> = {
  "public:read": "Public read",
  "recipes:read": "Recipe graph read",
  "cookbooks:read": "Cookbook graph read",
  "shopping_list:read": "Shopping list read",
  "shopping_list:write": "Shopping list write",
  "tokens:read": "Token metadata read",
  "tokens:write": "Bearer credential create and revoke",
  offline_access: "Refresh-capable authorization",
};

const exactEndpointScopes = new Set(["shopping_list:write", "tokens:read", "tokens:write"]);

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
  ["Tiny-device clients", "Use sync cursors, small payloads, and idempotent retries when a device is offline or battery constrained."],
  ["Mobile apps", "Read public recipes without auth, then request shopping-list scopes only after a chef connects their account."],
  ["CLI/script clients", "Use bearer credentials, curl, and OpenAPI JSON only when the script cannot share a Spoonjoy session."],
  ["Browser clients", "Use OAuth/PKCE with dynamic client registration instead of embedding long-lived secrets."],
  ["Agent clients", "Use MCP or delegated connection endpoints when a chef needs to approve an assistant-style runtime."],
] as const;

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
    sample: "https://spoonjoy.app/developers/playground",
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
    body: "Use GET /api/v1/shopping-list/sync with a cursor to fetch active rows and deletion records for removed rows.",
    sample: "curl 'https://spoonjoy.app/api/v1/shopping-list/sync?cursor=2026-06-01T00:00:00.000Z'\n  -H 'Authorization: Bearer sj_client_token'",
  },
  {
    title: "Perform an idempotent shopping-list mutation",
    scope: "Requires shopping_list:write",
    body: "Use POST /api/v1/shopping-list/items with clientMutationId so retries can replay the same write without duplicating items.",
    sample: "curl -X POST https://spoonjoy.app/api/v1/shopping-list/items\n  -H 'Authorization: Bearer sj_client_token'\n  -H 'Content-Type: application/json'\n  -d '{\"clientMutationId\":\"device-uuid-1\",\"name\":\"Eggs\",\"quantity\":12,\"unit\":\"Each\"}'",
  },
] as const;

const tokenAcquisitionPaths = [
  {
    title: "No token: signed-in browser",
    mode: "Same-origin",
    body: "A same-origin browser client does not fetch or store a bearer token. The chef signs into Spoonjoy with password, passkey, or any configured Google, GitHub, or Apple provider, and private API calls use the resulting session cookie.",
    sample: "Login surface: /login\nThen call: fetch(\"/api/v1/shopping-list\", { credentials: \"same-origin\" })",
  },
  {
    title: "Personal token: signed-in chef creates one",
    mode: "Direct token",
    body: "For a script, device, or developer-owned client, the chef signs in first and runs POST /api/v1/tokens from Session auth, such as through the generated playground. An existing bearer credential with tokens:write can also create another token, but never with broader scopes than it already has. Spoonjoy returns the raw sj_... secret once; save it outside browser bundles.",
    sample: "POST /api/v1/tokens\nAuth: Session cookie or Bearer sj_... with tokens:write\nBody: { \"name\": \"Kitchen script\", \"scopes\": [\"recipes:read\", \"shopping_list:read\"] }\nResponse: { \"token\": \"sj_...\" }",
  },
  {
    title: "Delegated token: OAuth/PKCE",
    mode: "Third-party",
    body: "For a third-party app, register a public client and redirect the chef to /oauth/authorize. If they are not signed in, Spoonjoy routes them through /login and the full auth surface before consent. The client never handles the chef's password. The client exchanges the authorization code at /oauth/token for an sj_... access_token plus rotating refresh_token.",
    sample: "POST /oauth/register\nGET /oauth/authorize?...code_challenge_method=S256\nPOST /oauth/token -> access_token: sj_...",
  },
  {
    title: "Delegated token: approval link",
    mode: "Agent/device",
    body: "For clients that cannot run a browser-based OAuth callback, call POST /api/tools/start_agent_connection, show the authorizationUrl to the chef, then poll POST /api/tools/poll_agent_connection. The approval page also uses Spoonjoy's full login surface before issuing a one-time sj_... token.",
    sample: "POST /api/tools/start_agent_connection -> authorizationUrl + deviceCode\nPOST /api/tools/poll_agent_connection -> token: sj_...",
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
    body: "Register a public client with token_endpoint_auth_method: none and no client secret, redirect the chef through consent, then exchange the single-use 60-second code with a form-encoded POST /oauth/token request. If the chef is not signed in, Spoonjoy routes them through /login first, where password, passkey, and configured Google, GitHub, or Apple sign-in all return to consent. Those provider buttons are Spoonjoy sign-in methods; external clients still use the /oauth/* endpoints. OAuth accepts kitchen:read and kitchen:write scopes; the returned sj_... access_token lasts 30 days, and refresh_token rotates on every refresh grant.",
    sample: "POST /oauth/register\nGET /oauth/authorize?response_type=code&scope=kitchen%3Aread+kitchen%3Awrite&code_challenge_method=S256\nPOST /oauth/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&client_id=...&code=...&code_verifier=...",
  },
  {
    title: "Auth failures",
    mode: "Errors",
    body: "Treat authentication_required and invalid_token as 401 responses, insufficient_scope as 403, and malformed Authorization headers as validation_error. Public endpoints can be anonymous; if you send credentials to an optional endpoint, Spoonjoy validates them and checks scopes. Log requestId or X-Request-Id for support.",
    sample: "{\n  \"ok\": false,\n  \"requestId\": \"client-shopping-list\",\n  \"error\": { \"code\": \"insufficient_scope\", \"status\": 403 }\n}",
  },
] as const;

const guideSteps = [
  "Read public recipes and cookbooks anonymously before adding auth.",
  "Use Session for logged-in playground calls; use bearer or OAuth only when a client runs outside that session.",
  "Use a stable mutation id for shopping-list writes, then retry with the same value when a network call is interrupted.",
  "Use the sync cursor to fetch shopping-list changes, including removed items.",
] as const;

export function meta() {
  return [
    { title: "Spoonjoy Developer Platform | Spoonjoy" },
    {
      name: "description",
      content: "Build clients on Spoonjoy's public Chef graph, REST API, OAuth, MCP, session auth, and bearer credentials.",
    },
  ];
}

export function loader() {
  return {
    resources: API_V1_RESOURCES,
    scopeRequirements: API_V1_SCOPE_REQUIREMENTS,
    errorStatus: API_V1_ERROR_STATUS,
    openapiUrl: "/api/v1/openapi.json",
    scopes: [...DEVELOPER_SCOPES],
  };
}

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "green" : method === "POST" ? "amber" : method === "PATCH" ? "blue" : "red";
  return <Badge color={color}>{method}</Badge>;
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--sj-border-strong)] py-8">
      <CookbookSectionTitle className="my-0">{title}</CookbookSectionTitle>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function scopeText(scope: string, exact: boolean) {
  if (exact) return scope;
  return scopeLabels[scope]!;
}

function scopeTone(scope: string) {
  if (scope.includes("write")) return "amber";
  if (scope.includes("tokens")) return "red";
  if (scope.includes("shopping")) return "green";
  return "zinc";
}

export default function Developers() {
  const { resources, scopeRequirements, errorStatus, openapiUrl, scopes } = useLoaderData<typeof loader>();

  return (
    <CookbookPage className="sj-developer-page">
      <CookbookHeader eyebrow="API v1" title="Spoonjoy Developer Platform" action={(
        <div className="flex flex-wrap gap-2">
          <Button href="/developers/playground">
            <Play data-slot="icon" aria-hidden="true" />
            Playground
          </Button>
          <Button href={openapiUrl} plain>
            <Braces data-slot="icon" aria-hidden="true" />
            OpenAPI JSON
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

      <SectionShell title="External Client Guide">
        <div className="grid gap-6">
          <div className="border-y border-[var(--sj-border)] py-4">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              Client examples
            </p>
            <ul className="mt-3 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {clientProfiles.map(([title, body]) => (
                <li key={title} className="flex gap-3 text-sm/6 text-[var(--sj-ink-soft)]">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--sj-brass)]" aria-hidden="true" />
                  <span>
                    <strong className="font-sj-ui font-bold text-[var(--sj-ink)]">{title}:</strong> {body}
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
                            {scopeText(scope, resource.name === "tokens" || resource.name === "shopping-list-items")}
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
                {exactEndpointScopes.has(scope) ? scopeLabels[scope] : scope}
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <div className="space-y-4 text-base/7 text-[var(--sj-ink-soft)]">
            <p>
              Idempotent shopping-list mutations use <Code>clientMutationId</Code> so clients can retry add, check,
              and remove calls without duplicating writes.
            </p>
            <p>
              Shopping-list reads support cursor sync and return tombstones for removed items. Checked and deleted
              state uses server-order last-writer-wins semantics.
            </p>
            <p>
              Spoonjoy endpoints are rate limited by IP and credential where applicable. Treat <Code>429</Code> as
              retryable, use backoff, and keep the same mutation id when retrying a write.
            </p>
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
