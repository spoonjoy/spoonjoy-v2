import type { Route } from "./+types/agent.connect";
import { Form, data, redirect, useLoaderData, useActionData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { enforceAgentCodeLookupRateLimit } from "~/lib/rate-limit.server";
import { getUserId } from "~/lib/session.server";
import {
  isSameSiteFormPost,
  normalizeUserCode,
  rememberTypedCode,
} from "~/lib/agent-connection-route.server";
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";

type LookupData = {
  code: string;
  error: string | null;
};

const NOT_FOUND = "That connection code was not found or has expired.";
const TOO_MANY = "Too many codes tried. Please wait a minute and try again.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Connect an agent - Spoonjoy" },
    { name: "description", content: "Connect an agent to your Spoonjoy kitchen." },
  ];
}

// The page never takes the code from its URL: a link with the code in it (from an older agent, or
// from someone else) must not stand in for the chef typing it.
export async function loader(_args: Route.LoaderArgs) {
  return { code: "", error: null } satisfies LookupData;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  if (!isSameSiteFormPost(request, env)) {
    return data({ code: "", error: "Type the code your agent shows you on this page." } satisfies LookupData, { status: 403 });
  }
  // Throttle before the lookup: a correct guess opens someone else's pending request.
  const rateLimit = await enforceAgentCodeLookupRateLimit(
    request,
    env?.AUTH_IP_RATE_LIMITER,
    () => getUserId(request, env),
  );
  const formData = await request.formData();
  const code = normalizeUserCode(formData.get("code")?.toString() ?? "");
  if (!rateLimit.allowed) {
    return data({ code, error: TOO_MANY } satisfies LookupData, {
      status: 429,
      headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
    });
  }
  if (!code) return { code, error: NOT_FOUND } satisfies LookupData;
  const db = await getRequestDb(context);
  const connection = await db.agentConnectionRequest.findUnique({ where: { userCode: code } });
  if (!connection) return { code, error: NOT_FOUND } satisfies LookupData;
  throw redirect(`/agent/connect/${connection.id}`, {
    headers: { "Set-Cookie": await rememberTypedCode(env, request, connection.id, code) },
  });
}

export default function AgentConnectLookup() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as LookupData | undefined;
  const view = actionData ?? loaderData;

  return (
    <main className="mx-auto flex min-h-[70svh] w-full max-w-xl flex-col justify-center px-6 py-12">
      <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        Agent access
      </p>
      <Heading className="mt-3">Enter Connection Code</Heading>
      <Text className="mt-5 text-lg/7">
        Enter the short Spoonjoy code shown by your device, CLI, or agent. You will sign in before approving access.
      </Text>
      <Form method="post" className="mt-8 grid gap-4">
        <label className="grid gap-2 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
          Connection code
          <input
            name="code"
            defaultValue={view.code}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-2345"
            className="min-h-12 border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 font-sj-ui text-xl font-semibold tracking-[0.12em] text-[var(--sj-ink)] outline-none focus:border-[var(--sj-brass)]"
          />
        </label>
        {view.error ? <Text role="alert">{view.error}</Text> : null}
        <div>
          <Button type="submit">Continue</Button>
        </div>
      </Form>
    </main>
  );
}
