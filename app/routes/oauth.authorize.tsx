import type { Route } from "./+types/oauth.authorize";
import { Form, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  handleOAuthAuthorizeAction,
  loadOAuthAuthorize,
  oauthAuthorizeTelemetryFor,
  oauthAuthorizeTelemetryForRequest,
  type AuthorizeRequestParams,
  type AuthorizeView,
  type OAuthAuthorizeTelemetryMetadata,
} from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse, type RateLimitScope } from "~/lib/rate-limit.server";
import {
  captureEvent,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";
import { AuthLayout } from "~/components/ui/auth-layout";
import { Heading } from "~/components/ui/heading";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

// Per-IP throttle on the OAuth 2.1 authorize endpoint — applied to both the
// loader (consent screen / login-gate redirect) and the action (Allow/Deny).
// Cheap to call; runs before any DB work.
async function checkAuthorizeRateLimit(request: Request, env: { API_IP_RATE_LIMITER?: unknown } | null | undefined) {
  const rateLimit = await enforceRateLimit({
    ip: request.headers.get("CF-Connecting-IP"),
    ipLimiter: env?.API_IP_RATE_LIMITER as Parameters<typeof enforceRateLimit>[0]["ipLimiter"],
  });
  if (!rateLimit.allowed) {
    return {
      response: rateLimitedResponse(rateLimit.retryAfterSeconds),
      scope: rateLimit.scope,
    };
  }
  return null;
}

function observeOAuthAuthorizeResult(
  args: Pick<Route.LoaderArgs, "context" | "request">,
  input: {
    phase: "loader" | "action";
    response: Response;
    startedAt: number;
    telemetry?: OAuthAuthorizeTelemetryMetadata;
    rateLimitScope?: RateLimitScope;
  },
): Response {
  const cloudflare = args.context.cloudflare;
  const env = cloudflare?.env;
  const waitUntil = cloudflare?.ctx?.waitUntil ? cloudflare.ctx.waitUntil.bind(cloudflare.ctx) : undefined;
  if (!env || !waitUntil) return input.response;

  const postHogConfig = resolvePostHogServerConfig(env);
  if (!postHogConfig.enabled) return input.response;

  const telemetry = { ...oauthAuthorizeTelemetryFor(input.response), ...input.telemetry };
  waitUntil(captureEvent(postHogConfig, {
    event: "spoonjoy.oauth.authorize",
    distinctId: telemetry.principalId ?? telemetry.clientId ?? "anon",
    properties: {
      route_template: "/oauth/authorize",
      phase: input.phase,
      method: args.request.method,
      status: input.response.status,
      outcome: telemetry.outcome ?? (input.response.status >= 400 ? "error" : undefined),
      client_id: telemetry.clientId,
      principal_id: telemetry.principalId,
      decision: telemetry.decision,
      error_code: telemetry.errorCode,
      state_class: telemetry.stateClass,
      scope: telemetry.scope,
      resource: telemetry.resource,
      request_bytes: requestContentBytes(args.request),
      origin_host: safeHeaderHost(args.request.headers.get("Origin")),
      referrer_host: safeHeaderHost(args.request.headers.get("Referer")),
      user_agent_family: userAgentFamily(args.request.headers.get("User-Agent")),
      rate_limit_scope: input.rateLimitScope,
      latency_ms: Math.max(0, Date.now() - input.startedAt),
    },
  }));

  return input.response;
}

function observeOAuthAuthorizeView(
  args: Pick<Route.LoaderArgs, "context" | "request">,
  input: {
    view: AuthorizeView;
    startedAt: number;
  },
): AuthorizeView {
  observeOAuthAuthorizeResult(args, {
    phase: "loader",
    response: new Response(null, { status: 200 }),
    startedAt: input.startedAt,
    telemetry: oauthAuthorizeTelemetryFor(input.view),
  });
  return input.view;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const startedAt = Date.now();
  const limited = await checkAuthorizeRateLimit(request, context.cloudflare?.env);
  if (limited) {
    throw observeOAuthAuthorizeResult({ request, context }, {
      phase: "loader",
      response: limited.response,
      startedAt,
      telemetry: {
        ...(await oauthAuthorizeTelemetryForRequest(request, "loader")),
        outcome: "rate_limited",
        errorCode: "rate_limited",
      },
      rateLimitScope: limited.scope,
    });
  }
  const db = await getRequestDb(context);
  const result = await loadOAuthAuthorize(request, db, context.cloudflare?.env);
  // Redirects (login gate / error back to the client) are thrown so React
  // Router performs them; consent/error views are returned for rendering.
  if (result instanceof Response) {
    throw observeOAuthAuthorizeResult({ request, context }, {
      phase: "loader",
      response: result,
      startedAt,
    });
  }
  return observeOAuthAuthorizeView({ request, context }, { view: result, startedAt });
}

export async function action({ request, context }: Route.ActionArgs) {
  const startedAt = Date.now();
  const limited = await checkAuthorizeRateLimit(request, context.cloudflare?.env);
  if (limited) {
    return observeOAuthAuthorizeResult({ request, context }, {
      phase: "action",
      response: limited.response,
      startedAt,
      telemetry: {
        ...(await oauthAuthorizeTelemetryForRequest(request, "action")),
        outcome: "rate_limited",
        errorCode: "rate_limited",
      },
      rateLimitScope: limited.scope,
    });
  }
  const db = await getRequestDb(context);
  const response = await handleOAuthAuthorizeAction(request, db, context.cloudflare?.env);
  return observeOAuthAuthorizeResult({ request, context }, {
    phase: "action",
    response,
    startedAt,
  });
}

const SCOPE_LABELS: Record<string, string> = {
  "account:read": "View your account profile and notification settings",
  "account:write": "Update your account profile, profile photo, and notification settings",
  "cookbooks:read": "View public cookbook data",
  "kitchen:read": "View public recipes, cookbooks, and your shopping list",
  "kitchen:write": "Add, edit, and remove Spoonjoy kitchen data through MCP tools and shopping-list operations",
  "public:read": "View public Spoonjoy data",
  "recipes:read": "View public recipe data",
  "shopping_list:read": "View your shopping list",
  "shopping_list:write": "Add, check, and remove items on your shopping list",
};

// The consent screen is only ever reached by a signed-in user, so its marketing
// column must not use the sign-in voice. The error view can render to anyone, so
// keep this copy auth-state-neutral (no "you're signed in" claim).
const CONNECTOR_AUTH_COPY = {
  eyebrow: "Kitchen connection",
  title: "Bring your kitchen with you.",
  description: "Review what each app can access before you let it into your kitchen.",
} as const;

function HiddenParams({ params }: { params: AuthorizeRequestParams }) {
  return (
    <>
      <input type="hidden" name="client_id" value={params.clientId} />
      <input type="hidden" name="redirect_uri" value={params.redirectUri} />
      <input type="hidden" name="response_type" value={params.responseType} />
      <input type="hidden" name="code_challenge" value={params.codeChallenge} />
      <input type="hidden" name="code_challenge_method" value={params.codeChallengeMethod} />
      <input type="hidden" name="scope" value={params.scope} />
      <input type="hidden" name="state" value={params.state} />
      <input type="hidden" name="resource" value={params.resource} />
    </>
  );
}

export default function OAuthAuthorize() {
  const view = useLoaderData<AuthorizeView>();

  if (view.kind === "error") {
    return (
      <AuthLayout {...CONNECTOR_AUTH_COPY}>
        <div className="w-full max-w-sm">
          <Heading>Connection problem</Heading>
          <Text className="mt-4" role="alert">
            {view.message}
          </Text>
        </div>
      </AuthLayout>
    );
  }

  const appName = view.clientName || "This app";
  const redirectOrigin = new URL(view.params.redirectUri).origin;
  const resourceLabel = view.params.resource || "REST API";
  const broadScopes = view.scope.split(" ").filter((scope) => scope === "kitchen:read" || scope === "kitchen:write");
  return (
    <AuthLayout {...CONNECTOR_AUTH_COPY}>
      <div className="w-full max-w-sm">
        <Heading>Authorize {appName}</Heading>
        <Text className="mt-4">
          {appName} is an unverified OAuth app name supplied by the developer. It wants to connect to your Spoonjoy kitchen and will be able to:
        </Text>
        <ul className="mt-4 space-y-2">
          {view.scope.split(" ").map((scope) => (
            <li key={scope} className="text-sm text-[var(--sj-ink)]">
              • {SCOPE_LABELS[scope] ?? scope}
            </li>
          ))}
        </ul>
        <dl className="mt-5 space-y-2 border-y border-[var(--sj-border)] py-4 text-sm text-[var(--sj-ink)]">
          <div>
            <dt className="font-semibold">Redirect origin</dt>
            <dd className="break-words">{redirectOrigin}</dd>
          </div>
          <div>
            <dt className="font-semibold">Client id</dt>
            <dd className="break-all font-mono text-xs">{view.params.clientId}</dd>
          </div>
          <div>
            <dt className="font-semibold">Resource</dt>
            <dd className="break-words">{resourceLabel}</dd>
          </div>
        </dl>
        {broadScopes.length ? (
          <Text className="mt-4" role="alert">
            This request includes broad kitchen scopes. Approve only if you trust this app to act across Spoonjoy kitchen data.
          </Text>
        ) : null}
        <Text className="mt-4">
          Access tokens are short-lived; refresh tokens rotate and can be disconnected by revoking the app's refresh token.
        </Text>
        <div className="mt-6 flex flex-wrap gap-3">
          <Form method="post">
            <HiddenParams params={view.params} />
            <Button type="submit" name="decision" value="approve">
              Allow access
            </Button>
          </Form>
          <Form method="post">
            <HiddenParams params={view.params} />
            <Button type="submit" name="decision" value="deny" plain>
              Deny
            </Button>
          </Form>
        </div>
      </div>
    </AuthLayout>
  );
}
