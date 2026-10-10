import type { Route } from "./+types/agent.connect.$requestId";
import { Form, data, redirect, useActionData, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getCurrentSessionIdentity, getUserId } from "~/lib/session.server";
import {
  approveAgentConnectionRequest,
  denyAgentConnectionRequest,
  getAgentConnectionRequest,
  type AgentConnectionPublicStatus,
} from "~/lib/agent-connection.server";
import {
  AGENT_CONNECTION_TOKEN_TTL_DAYS,
  AGENT_CONNECTION_WRITE_SCOPES,
  isGrantableAgentConnectionScope,
} from "~/lib/agent-connection-scopes";
import { requestNetworkDetails } from "~/lib/spoonjoy-api-request.server";
import {
  isSameSiteFormPost,
  normalizeUserCode,
  typedCodeFor,
} from "~/lib/agent-connection-route.server";
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";

type Requester = {
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  requestedMinutesAgo: number;
};

type LoaderData = {
  status: AgentConnectionPublicStatus | "missing";
  agentName: string;
  scopes: string[];
  userEmail: string | null;
  expiresAt: string | null;
  // Only once the chef has typed the code for this request (on the lookup page).
  confirmedCode?: string | null;
  requester?: Requester | null;
  approverCountry?: string | null;
};

type ActionData = { error: string };

const SCOPE_LABELS: Record<string, string> = {
  "cookbooks:read": "Read public cookbooks",
  "kitchen:read": "Read public recipes, cookbooks, and your shopping list",
  "kitchen:write": "Create, change, and delete your recipes, cookbooks, and shopping list",
  "public:read": "Read public Spoonjoy data",
  "recipes:read": "Read public recipes",
  "shopping_list:read": "Read your shopping list",
  "shopping_list:write": "Add, check, and remove shopping-list items",
};

const WRITE_SCOPE_WARNINGS: Record<(typeof AGENT_CONNECTION_WRITE_SCOPES)[number], string> = {
  "shopping_list:write": "can add, check off, and remove items on your shopping list.",
  "kitchen:write": "can create, change, and delete your recipes and cookbooks, and change your shopping list.",
};

const MISSING: LoaderData = {
  status: "missing",
  agentName: "this agent",
  scopes: [],
  userEmail: null,
  expiresAt: null,
};

function loginRedirect(request: Request): string {
  // Only the path: an older link may carry ?code=, which must not survive into the approval.
  return `/login?redirectTo=${encodeURIComponent(new URL(request.url).pathname)}`;
}

function connectionTitle(status: LoaderData["status"]): string {
  if (status === "pending") return "Connect Spoonjoy";
  if (status === "approved" || status === "claimed") return "Spoonjoy Connected";
  if (status === "denied") return "Connection Denied";
  return "Connection Expired";
}

export function meta({ data }: Route.MetaArgs) {
  const status = data?.status ?? "expired";
  return [
    { title: connectionTitle(status) },
    { name: "description", content: "Connect an agent to your Spoonjoy kitchen." },
  ];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare?.env;
  const db = await getRequestDb(context);
  const connection = await getAgentConnectionRequest(db, params.requestId);
  if (!connection) return MISSING;

  const scopes = connection.scopes.split(/\s+/).filter(Boolean);
  if (connection.status !== "pending") {
    return {
      status: connection.status as AgentConnectionPublicStatus,
      agentName: connection.agentName,
      scopes,
      userEmail: null,
      expiresAt: connection.expiresAt.toISOString(),
    } satisfies LoaderData;
  }

  const userId = await getUserId(request, env);
  if (!userId) throw redirect(loginRedirect(request));

  // getUserId has just confirmed this account exists.
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const typedCode = await typedCodeFor(env, request, connection.id);
  return {
    status: "pending",
    agentName: connection.agentName,
    scopes,
    userEmail: user.email,
    expiresAt: connection.expiresAt.toISOString(),
    confirmedCode: typedCode === connection.userCode ? typedCode : null,
    requester: {
      ip: connection.requesterIp,
      country: connection.requesterCountry,
      userAgent: connection.requesterUserAgent,
      requestedMinutesAgo: Math.max(0, Math.floor((Date.now() - connection.createdAt.getTime()) / 60000)),
    },
    approverCountry: requestNetworkDetails(request).country,
  } satisfies LoaderData;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare?.env;
  const identity = await getCurrentSessionIdentity(request, env);
  if (!identity) throw redirect(loginRedirect(request));
  if (!isSameSiteFormPost(request, env)) {
    return data({ error: "Approve or deny this connection from this page." } satisfies ActionData, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const db = await getRequestDb(context);
  const connection = await getAgentConnectionRequest(db, params.requestId);
  if (!connection) {
    return data({ error: "This connection request was not found or has expired." } satisfies ActionData, { status: 404 });
  }

  if (intent !== "approve" && intent !== "deny") {
    return data({ error: "Choose approve or deny" } satisfies ActionData, { status: 400 });
  }

  // Approve and deny both need the code from the chef: typed into this page, or typed earlier on
  // the lookup page (remembered in a signed cookie for this request only). It is never read from
  // the link, so a leaked link or a guessed request can neither connect nor cancel a connection.
  const typedCode = normalizeUserCode(formData.get("userCode")?.toString() ?? "")
    || (await typedCodeFor(env, request, connection.id))
    || "";
  if (typedCode !== connection.userCode) {
    return data(
      {
        error: intent === "deny"
          ? "That code doesn't match. To deny, type the code your agent shows you."
          : "That code doesn't match. Type the code your agent shows you.",
      } satisfies ActionData,
      { status: 400 },
    );
  }

  if (intent === "deny") {
    await denyAgentConnectionRequest(db, params.requestId);
    throw redirect(`/agent/connect/${params.requestId}`);
  }

  // A request started before account scopes were refused can't be approved with them.
  if (!isGrantableAgentConnectionScope(connection.scopes)) {
    return data(
      { error: "This request asks for account access, which agent connections can't grant. Ask your agent to start a new connection." } satisfies ActionData,
      { status: 400 },
    );
  }

  await approveAgentConnectionRequest(db, params.requestId, identity);
  throw redirect(`/agent/connect/${params.requestId}`);
}

function requestedAgo(minutes: number): string {
  if (minutes < 1) return "less than a minute ago";
  if (minutes === 1) return "1 minute ago";
  return `${minutes} minutes ago`;
}

const LABEL = "font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]";

export default function AgentConnect() {
  const connection = useLoaderData<typeof loader>() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const actionable = connection.status === "pending";
  const connected = connection.status === "approved" || connection.status === "claimed";
  const scopes = connection.scopes ?? [];
  const writeScopes = AGENT_CONNECTION_WRITE_SCOPES.filter((scope) => scopes.includes(scope));
  const requester = connection.requester;

  return (
    <main className="mx-auto flex min-h-[70svh] w-full max-w-xl flex-col justify-center px-6 py-12">
      <p className={LABEL}>Agent access</p>
      <Heading className="mt-3">{connectionTitle(connection.status)}</Heading>
      <Text className="mt-5 text-lg/7">
        {actionable
          ? `A client calling itself "${connection.agentName}" wants permission to use Spoonjoy with these exact scopes.`
          : connected
            ? `A client calling itself "${connection.agentName}" is now connected to your Spoonjoy kitchen.`
            : connection.status === "denied"
              ? `The client calling itself "${connection.agentName}" was not given access to your Spoonjoy kitchen.`
              : "This Spoonjoy connection link is no longer available."}
      </Text>

      {actionable ? (
        <>
          <Text className="mt-5" role="alert">
            Spoonjoy did not verify who made this request; the name above is whatever the client chose. If you didn't just start this connection from your own agent, device, or app, close this page. Without its code, nobody can approve it, and it expires on its own.
          </Text>

          {requester ? (
            <div className="mt-6 border-y border-[var(--sj-border)] py-5">
              <p className={LABEL}>Request details</p>
              <dl className="mt-3 grid gap-2 text-sm/6 text-[var(--sj-ink)]">
                <div>
                  <dt className="inline font-semibold">Requested </dt>
                  <dd className="inline">{requestedAgo(requester.requestedMinutesAgo)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">From </dt>
                  <dd className="inline break-all">
                    {requester.ip ?? "an unknown IP address"}
                    {requester.country ? ` (${requester.country})` : ""}
                  </dd>
                </div>
                {requester.userAgent ? (
                  <div>
                    <dt className="inline font-semibold">Client software </dt>
                    <dd className="inline break-all">{requester.userAgent}</dd>
                  </div>
                ) : null}
                {connection.approverCountry ? (
                  <div>
                    <dt className="inline font-semibold">You are in </dt>
                    <dd className="inline">{connection.approverCountry}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : null}
        </>
      ) : null}

      {(actionable || connected) && scopes.length > 0 ? (
        // Directly under "Request details", share its bottom rule instead of drawing a second one.
        <div
          className={actionable && requester
            ? "border-b border-[var(--sj-border)] py-5"
            : "mt-6 border-y border-[var(--sj-border)] py-5"}
        >
          <p className={LABEL}>{connected ? "Access granted" : "Requested scopes"}</p>
          <ul className="mt-3 grid gap-2">
            {scopes.map((scope) => (
              <li key={scope} className="text-sm/6 text-[var(--sj-ink)]">
                <span className="font-mono font-semibold">{scope}</span>
                {" "}
                <span className="text-[var(--sj-ink-soft)]">{SCOPE_LABELS[scope] ?? "Custom delegated scope"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionable && writeScopes.length > 0 ? (
        <ul className="mt-5 grid gap-2" aria-label="Write access warnings">
          {writeScopes.map((scope) => (
            <li key={scope}>
              <Text>
                <strong>Write access:</strong> with <span className="font-mono">{scope}</span>, this client {WRITE_SCOPE_WARNINGS[scope]}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}

      {connection.userEmail && actionable && (
        <Text className="mt-5">
          You are approving as {connection.userEmail}.
        </Text>
      )}

      {actionable ? (
        <Text className="mt-5">
          Approval creates a Spoonjoy bearer token for this client that lasts {AGENT_CONNECTION_TOKEN_TTL_DAYS} days. The client should never ask for your Spoonjoy password, and you can revoke the token in account settings.
        </Text>
      ) : null}

      {connected ? (
        <>
          <Text className="mt-5">
            This access lasts {AGENT_CONNECTION_TOKEN_TTL_DAYS} days from approval. You can revoke it at any time under API and app access in your account settings.
          </Text>
          <div className="mt-8 flex flex-col sm:flex-row">
            <Button href="/account/settings" plain>
              Manage connected apps and tokens
            </Button>
          </div>
        </>
      ) : null}

      {actionData?.error ? (
        <Text className="mt-5" role="alert">{actionData.error}</Text>
      ) : null}

      {actionable && (
        <Form method="post" className="mt-8 grid gap-4">
          {connection.confirmedCode ? (
            <div className="border-y border-[var(--sj-border)] py-5">
              <p className={LABEL}>Code you entered</p>
              <p className="mt-2 font-sj-ui text-2xl font-semibold tracking-[0.12em] text-[var(--sj-ink)]">
                {connection.confirmedCode}
              </p>
            </div>
          ) : (
            <label className="grid gap-2 font-sj-ui text-sm font-semibold text-[var(--sj-ink)]">
              Type the code your agent shows you
              <input
                name="userCode"
                required
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ABCD-2345"
                className="min-h-12 border border-[var(--sj-border)] bg-[var(--sj-paper)] px-3 font-sj-ui text-xl font-semibold tracking-[0.12em] text-[var(--sj-ink)] outline-none focus:border-[var(--sj-brass)]"
              />
            </label>
          )}
          {/* Full-width stacked buttons on phones, side by side from sm up, as on the other auth pages.
              Deny needs the code too, so a leaked link or a guessed request can't cancel a connection;
              the browser asks for the code before either button submits. */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" name="intent" value="approve">
              Approve access
            </Button>
            <Button type="submit" name="intent" value="deny" plain>
              Deny
            </Button>
          </div>
        </Form>
      )}
    </main>
  );
}
