import type { Route } from "./+types/oauth.authorize";
import type { ReactNode } from "react";
import { useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  handleOAuthAuthorizeAction,
  loadOAuthAuthorize,
  oauthAuthorizeTelemetryFor,
  oauthAuthorizeTelemetryForRequest,
  withOAuthAuthorizeTelemetry,
  type AuthorizeRequestParams,
  type AuthorizeView,
  type OAuthAuthorizeTelemetryMetadata,
} from "~/lib/oauth-routes.server";
import { getOAuthClient } from "~/lib/oauth-server.server";
import { redirectTo, resolveOAuthProviderHintStartPath } from "~/lib/oauth-route.server";
import { enforceRateLimit, rateLimitedResponse, type RateLimitScope } from "~/lib/rate-limit.server";
import {
  captureEvent,
  requestContentBytes,
  resolvePostHogServerConfig,
  safeHeaderHost,
  userAgentFamily,
} from "~/lib/analytics-server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
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

function safeIssuerHost(request: Request, baseUrl: string | null | undefined): string | undefined {
  try {
    return safeHeaderHost(resolveIssuerOrigin(request.url, baseUrl));
  } catch {
    return undefined;
  }
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
      request_host: safeHeaderHost(args.request.url),
      issuer_host: safeIssuerHost(args.request, env.SPOONJOY_BASE_URL),
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
    const telemetry = oauthAuthorizeTelemetryFor(result);
    if (telemetry.outcome === "login_redirect") {
      const clientId = new URL(request.url).searchParams.get("client_id")!;
      const client = await getOAuthClient(db, clientId);
      const providerStartPath = resolveOAuthProviderHintStartPath(request, client);
      if (providerStartPath) {
        const providerResponse = withOAuthAuthorizeTelemetry(redirectTo(providerStartPath), telemetry);
        throw observeOAuthAuthorizeResult({ request, context }, {
          phase: "loader",
          response: providerResponse,
          startedAt,
        });
      }
    }
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
  "account:read": "Read your profile and notification settings",
  "account:write": "Update your profile, photo, and notification settings",
  "cookbooks:read": "Read public cookbook data",
  "kitchen:read": "Read recipes, cookbooks, and your shopping list",
  "kitchen:write": "Add, edit, and remove kitchen data",
  "public:read": "Read public Spoonjoy data",
  "recipes:read": "Read public recipe data",
  "shopping_list:read": "Read your shopping list",
  "shopping_list:write": "Add, check, and remove shopping-list items",
};

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

function ConnectorConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[calc(100svh-5rem)] px-5 py-8 sm:px-8 sm:py-10">
      <section className="mx-auto w-full max-w-2xl">
        {children}
      </section>
    </main>
  );
}

function scopeItems(scope: string): string[] {
  const scopes = scope.split(" ").filter(Boolean);
  return Array.from(new Set(scopes.map((item) => SCOPE_LABELS[item] ?? item)));
}

export default function OAuthAuthorize() {
  const view = useLoaderData<AuthorizeView>();

  if (view.kind === "error") {
    return (
      <ConnectorConsentShell>
        <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
          Kitchen connection
        </p>
        <Heading className="mt-3">Connection problem</Heading>
        <Text className="mt-4" role="alert">
          {view.message}
        </Text>
      </ConnectorConsentShell>
    );
  }

  const appName = view.clientName || "This app";
  const redirectOrigin = new URL(view.params.redirectUri).origin;
  const resourceLabel = view.params.resource || "REST API";
  const broadScopes = view.scope.split(" ").filter((scope) => scope === "kitchen:read" || scope === "kitchen:write");
  const accessItems = scopeItems(view.scope);
  return (
    <ConnectorConsentShell>
      <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        Kitchen connection
      </p>
      <Heading className="mt-3">Connect {appName} to Spoonjoy</Heading>
      <Text className="mt-4 text-base/7">
        {appName} wants access to your Spoonjoy kitchen.
      </Text>

      <div className="mt-6 border-y border-[var(--sj-border)] py-5">
        <h2 className="font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">Access requested</h2>
        <ul className="mt-3 space-y-2 text-sm/6 text-[var(--sj-ink)]">
          {accessItems.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true">-</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {broadScopes.length ? (
        <Text className="mt-4" role="alert">
          {appName} can make broad kitchen changes. Approve only if this is the connection you started.
        </Text>
      ) : null}
      <Text className="mt-4">
        This connection stays active until you disconnect it in Account settings or from {appName}.
      </Text>

      <details className="mt-5 border-y border-[var(--sj-border)] py-4 text-sm text-[var(--sj-ink)]">
        <summary className="cursor-default font-sj-ui font-semibold text-[var(--sj-ink)]">
          Connection details
        </summary>
        <dl className="mt-4 space-y-3">
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="font-semibold">Redirect origin</dt>
            <dd className="break-words">{redirectOrigin}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="font-semibold">Client id</dt>
            <dd className="break-all font-mono text-xs">{view.params.clientId}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="font-semibold">Resource</dt>
            <dd className="break-words">{resourceLabel}</dd>
          </div>
        </dl>
      </details>

      <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
        <form method="post">
          <HiddenParams params={view.params} />
          <Button className="w-full sm:w-auto" type="submit" name="decision" value="approve">
            Allow access
          </Button>
        </form>
        <form method="post">
          <HiddenParams params={view.params} />
          <Button className="w-full sm:w-auto" type="submit" name="decision" value="deny" plain>
            Deny
          </Button>
        </form>
      </div>
    </ConnectorConsentShell>
  );
}
