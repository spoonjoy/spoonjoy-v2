import type { Route } from "./+types/agent.connect.$requestId";
import { Form, data, redirect, useLoaderData } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import {
  approveAgentConnectionRequest,
  denyAgentConnectionRequest,
  getAgentConnectionRequest,
  type AgentConnectionPublicStatus,
} from "~/lib/agent-connection.server";
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";

type LoaderData = {
  status: AgentConnectionPublicStatus | "missing";
  agentName: string;
  userCode: string | null;
  scopes: string[];
  userEmail: string | null;
  expiresAt: string | null;
};

const SCOPE_LABELS: Record<string, string> = {
  "cookbooks:read": "Read public cookbooks",
  "kitchen:read": "Read public recipes, cookbooks, and your shopping list",
  "kitchen:write": "Use write-capable kitchen tools and shopping-list writes",
  "public:read": "Read public Spoonjoy data",
  "recipes:read": "Read public recipes",
  "shopping_list:read": "Read your shopping list",
  "shopping_list:write": "Add, check, and remove shopping-list items",
};

function loginRedirect(request: Request): string {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  return `/login?redirectTo=${encodeURIComponent(path)}`;
}

function connectionTitle(status: LoaderData["status"]): string {
  if (status === "pending") return "Connect Spoonjoy";
  if (status === "approved" || status === "claimed") return "Spoonjoy Connected";
  if (status === "denied") return "Connection Denied";
  return "Connection Expired";
}

function normalizeUserCode(value: string | null): string {
  const compact = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const db = await getRequestDb(context);
  const connection = await getAgentConnectionRequest(db, params.requestId);
  if (!connection) {
    return {
      status: "missing",
      agentName: "this agent",
      userCode: null,
      scopes: [],
      userEmail: null,
      expiresAt: null,
    } satisfies LoaderData;
  }

  const suppliedCode = normalizeUserCode(new URL(request.url).searchParams.get("code"));
  if (connection.status === "pending" && suppliedCode !== connection.userCode) {
    return {
      status: "missing",
      agentName: "this agent",
      userCode: null,
      scopes: [],
      userEmail: null,
      expiresAt: null,
    } satisfies LoaderData;
  }

  const userId = await getUserId(request, context.cloudflare?.env);
  if (!userId && connection.status === "pending") {
    throw redirect(loginRedirect(request));
  }

  const user = userId
    ? await db.user.findUnique({ where: { id: userId }, select: { email: true } })
    : null;

  return {
    status: connection.status as AgentConnectionPublicStatus,
    agentName: connection.agentName,
    userCode: connection.userCode,
    scopes: connection.scopes.split(/\s+/).filter(Boolean),
    userEmail: user?.email ?? null,
    expiresAt: connection.expiresAt.toISOString(),
  } satisfies LoaderData;
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  if (!userId) throw redirect(loginRedirect(request));

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const userCode = normalizeUserCode(formData.get("userCode")?.toString() ?? "");
  const db = await getRequestDb(context);
  const connection = await getAgentConnectionRequest(db, params.requestId);
  if (!connection || userCode !== connection.userCode) {
    return data({ error: "Connection code is required" }, { status: 400 });
  }

  if (intent === "approve") {
    await approveAgentConnectionRequest(db, params.requestId, userId);
    throw redirect(`/agent/connect/${params.requestId}`);
  }

  if (intent === "deny") {
    await denyAgentConnectionRequest(db, params.requestId);
    throw redirect(`/agent/connect/${params.requestId}`);
  }

  return data({ error: "Choose approve or deny" }, { status: 400 });
}

export default function AgentConnect() {
  const connection = useLoaderData<typeof loader>();
  const actionable = connection.status === "pending";
  const scopes = connection.scopes ?? [];
  const broadScopes = scopes.filter((scope) => scope === "kitchen:read" || scope === "kitchen:write");

  return (
    <main className="mx-auto flex min-h-[70svh] w-full max-w-xl flex-col justify-center px-6 py-12">
      <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
        Agent access
      </p>
      <Heading className="mt-3">{connectionTitle(connection.status)}</Heading>
      <Text className="mt-5 text-lg/7">
        {actionable
          ? `${connection.agentName} wants permission to use Spoonjoy with these exact scopes.`
          : connection.status === "approved" || connection.status === "claimed"
            ? `${connection.agentName} can now use Spoonjoy on your behalf.`
            : connection.status === "denied"
              ? `${connection.agentName} was not given access to your Spoonjoy kitchen.`
              : "This Spoonjoy connection link is no longer available."}
      </Text>

      {connection.userCode && (
        <div className="mt-8 border-y border-[var(--sj-border)] py-5">
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
            Code
          </p>
          <p className="mt-2 font-sj-ui text-2xl font-semibold tracking-[0.12em] text-[var(--sj-ink)]">
            {connection.userCode}
          </p>
        </div>
      )}

      {actionable && scopes.length > 0 ? (
        <div className="mt-6 border-y border-[var(--sj-border)] py-5">
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
            Requested scopes
          </p>
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

      {connection.userEmail && actionable && (
        <Text className="mt-5">
          You are approving as {connection.userEmail}.
        </Text>
      )}

      {actionable ? (
        <>
          {broadScopes.length ? (
            <Text className="mt-5" role="alert">
              This request includes broad kitchen scopes. Approve only if you trust this client to act across Spoonjoy kitchen data.
            </Text>
          ) : null}
          <Text className="mt-5">
            Approval creates a normal Spoonjoy bearer token for this client. The client should never ask for your Spoonjoy password, and the token can be revoked later through Spoonjoy token-management APIs.
          </Text>
        </>
      ) : null}

      {actionable && (
        <Form method="post" className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input type="hidden" name="userCode" value={connection.userCode ?? ""} />
          <Button type="submit" name="intent" value="approve">
            Approve Access
          </Button>
          <Button type="submit" name="intent" value="deny" plain>
            Deny
          </Button>
        </Form>
      )}
    </main>
  );
}
