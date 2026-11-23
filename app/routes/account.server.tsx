import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/account.server";
import { Button } from "~/components/ouro/button/button";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import {
  createServerInvite,
  isServerAdmin,
  listServerInvites,
  revokeServerInvite,
  setSignupMode,
  signupMode,
} from "~/lib/server-access.server";

// A self-hosted server's own settings, for its admin (its first account) only: whether strangers
// may sign up, and invite links that let one person sign up while they may not. To anyone else,
// and on spoonjoy.app, the page does not exist.

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Server settings - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

async function requireAdmin(request: Request, context: Route.LoaderArgs["context"]) {
  const env = context.cloudflare?.env;
  const userId = await requireUserId(request, "/login", env);
  const db = await getRequestDb(context);
  if (!(await isServerAdmin(db, env, userId))) throw new Response("Not Found", { status: 404 });
  return { env, userId, db };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, db } = await requireAdmin(request, context);
  const invites = await listServerInvites(db);
  return {
    signups: await signupMode(db, env),
    invites: invites.map((invite) => ({ id: invite.id, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() })),
  };
}

export type ServerSettingsActionData =
  | { intent: string; success: true; link?: string }
  | { intent: string; success: false; error: string };

export async function action({ request, context }: Route.ActionArgs) {
  const { env, userId, db } = await requireAdmin(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const fail = (error: string, status: number) => data<ServerSettingsActionData>({ intent, success: false, error }, { status });
  switch (intent) {
    case "signups": {
      const mode = form.get("mode");
      if (mode !== "open" && mode !== "invite") return fail("Choose open or invite-only.", 400);
      const current = await signupMode(db, env);
      if (current.setBy === "env") {
        return fail(`SPOONJOY_SIGNUPS sets this server's sign-ups to ${current.mode}. Change it where the server is started.`, 409);
      }
      await setSignupMode(db, env, mode);
      return data<ServerSettingsActionData>({ intent, success: true });
    }
    case "invite": {
      const { token } = await createServerInvite(db, userId);
      const origin = env?.SPOONJOY_BASE_URL && URL.canParse(env.SPOONJOY_BASE_URL) ? new URL(env.SPOONJOY_BASE_URL).origin : new URL(request.url).origin;
      return data<ServerSettingsActionData>({ intent, success: true, link: `${origin}/signup?invite=${token}` });
    }
    case "revoke": {
      await revokeServerInvite(db, String(form.get("inviteId") ?? ""));
      return data<ServerSettingsActionData>({ intent, success: true });
    }
    default:
      return fail("Unknown action.", 400);
  }
}

function SignupsSwitch({ signups }: { signups: Awaited<ReturnType<typeof loader>>["signups"] }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  const busy = fetcher.state !== "idle";
  const failure = fetcher.data && !fetcher.data.success ? fetcher.data.error : null;
  const open = signups.mode === "open";
  return (
    <section className="mt-8" aria-labelledby="server-signups" data-testid="server-signups">
      <SectionHeader id="server-signups" title="Sign-ups" level={2} />
      <Text className="mt-2" data-testid="server-signups-mode">{open ? "Open" : "Invite only"}</Text>
      <Text tone="muted" size="sm" className="mt-1">
        {open
          ? "Anyone who can reach this server can make an account."
          : "Only people with an invite link can make an account. Everyone who has one still signs in."}
        {signups.setBy === "env" ? " SPOONJOY_SIGNUPS sets this where the server is started." : null}
      </Text>
      {failure ? <Text role="alert" tone="destructive" size="sm" className="mt-2">{failure}</Text> : null}
      {signups.setBy === "env" ? null : (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "signups", mode: open ? "invite" : "open" }, { method: "post" })}
        >
          {open ? "Make invite-only" : "Open sign-ups"}
        </Button>
      )}
    </section>
  );
}

function InviteRow({ invite }: { invite: Awaited<ReturnType<typeof loader>>["invites"][number] }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <Text size="sm">
        Made <LocalDate value={invite.createdAt} />, works until <LocalDate value={invite.expiresAt} />
      </Text>
      <Button
        type="button"
        variant="outline"
        tone="destructive"
        size="sm"
        disabled={fetcher.state !== "idle"}
        onClick={() => fetcher.submit({ intent: "revoke", inviteId: invite.id }, { method: "post" })}
      >
        Revoke
      </Button>
    </li>
  );
}

function Invites({ invites }: { invites: Awaited<ReturnType<typeof loader>>["invites"] }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  const link = fetcher.data?.success && fetcher.data.intent === "invite" ? fetcher.data.link : null;
  return (
    <section className="mt-10" aria-labelledby="server-invites" data-testid="server-invites">
      <SectionHeader id="server-invites" title="Invite links" level={2} />
      <Text tone="muted" size="sm" className="mt-2">
        Each link signs up one account and stops working after seven days. Spoonjoy shows it once, so copy it now.
      </Text>
      <Button
        type="button"
        className="mt-3"
        disabled={fetcher.state !== "idle"}
        onClick={() => fetcher.submit({ intent: "invite" }, { method: "post" })}
      >
        Make an invite link
      </Button>
      {link ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="break-all font-sj-ui text-sm" data-testid="server-invite-link">{link}</code>
          <CopyButton value={link} label="Copy link" size="sm" />
        </div>
      ) : null}
      {invites.length > 0 ? (
        <ul className="mt-6 divide-y divide-[var(--sj-border)]" aria-label="Invite links that still work">
          {invites.map((invite) => <InviteRow key={invite.id} invite={invite} />)}
        </ul>
      ) : null}
    </section>
  );
}

export default function ServerSettings() {
  const { signups, invites } = useLoaderData<typeof loader>();
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Server settings"
        title="This server"
        size="lg"
        divider
        description="You made this server's first account, so you decide who else can join it. You can also review reports at /moderation."
      />
      <SignupsSwitch signups={signups} />
      <Invites invites={invites} />
    </CookbookPage>
  );
}
