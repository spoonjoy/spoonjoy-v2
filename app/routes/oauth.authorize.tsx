import type { Route } from "./+types/oauth.authorize";
import { Form, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import {
  handleOAuthAuthorizeAction,
  loadOAuthAuthorize,
  type AuthorizeRequestParams,
  type AuthorizeView,
} from "~/lib/oauth-routes.server";
import { enforceRateLimit, rateLimitedResponse } from "~/lib/rate-limit.server";
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
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);
  return null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const limited = await checkAuthorizeRateLimit(request, context.cloudflare?.env);
  if (limited) throw limited;
  const db = await getRequestDb(context);
  const result = await loadOAuthAuthorize(request, db, context.cloudflare?.env);
  // Redirects (login gate / error back to the client) are thrown so React
  // Router performs them; consent/error views are returned for rendering.
  if (result instanceof Response) throw result;
  return result;
}

export async function action({ request, context }: Route.ActionArgs) {
  const limited = await checkAuthorizeRateLimit(request, context.cloudflare?.env);
  if (limited) return limited;
  const db = await getRequestDb(context);
  return handleOAuthAuthorizeAction(request, db, context.cloudflare?.env);
}

const SCOPE_LABELS: Record<string, string> = {
  "kitchen:read": "View your recipes, cookbooks, and shopping list",
  "kitchen:write": "Add and edit your recipes, cookbooks, and shopping list",
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
      <input type="hidden" name="code_challenge" value={params.codeChallenge} />
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
  return (
    <AuthLayout {...CONNECTOR_AUTH_COPY}>
      <div className="w-full max-w-sm">
        <Heading>Authorize {appName}</Heading>
        <Text className="mt-4">
          {appName} wants to connect to your Spoonjoy kitchen and will be able to:
        </Text>
        <ul className="mt-4 space-y-2">
          {view.scope.split(" ").map((scope) => (
            <li key={scope} className="text-sm text-[var(--sj-ink)]">
              • {SCOPE_LABELS[scope] ?? scope}
            </li>
          ))}
        </ul>
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
