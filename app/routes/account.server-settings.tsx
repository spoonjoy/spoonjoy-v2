import { requestD1 } from "~/lib/d1-read.server";
import { useState } from "react";
import { data, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/account.server-settings";
import { Button } from "~/components/ouro/button/button";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Link } from "~/components/ouro/link/link";
import { LocalDate } from "~/components/ouro/local-date/local-date";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { TextField } from "~/components/ouro/text-field/text-field";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
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
import { AI_PROVIDERS, serverAi, setServerAi, type AiProvider } from "~/lib/server-ai.server";
import { ServerBackupError, serverBackups, type BackupMade, type BackupRestored, type ServerBackup, type ServerBackups } from "~/lib/self-host-backups.server";

// A self-hosted server's own settings, for its admin (its first account) only: whether strangers
// may sign up, invite links that let one person sign up while they may not, which AI the server
// uses, and the server's backups. To anyone else, and on spoonjoy.app, the page does not exist.

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

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Context = Route.LoaderArgs["context"];

// A backup, restore or listing that failed, to the owner's own PostHog if they set one up (off
// otherwise). Another backup already running is not a failure.
function reportBackupFailure(context: Context, request: Request, userId: string, error: unknown, step: string) {
  if (error instanceof ServerBackupError && error.status === 409) return;
  // Only a server with the SELF_HOST binding gets here, so its env is there.
  const capture = captureException(resolvePostHogServerConfig(context.cloudflare!.env!), {
    error,
    distinctId: userId,
    route: new URL(request.url).pathname,
    method: request.method,
    extras: { action: `server_backups_${step}` },
  });
  context.cloudflare?.ctx?.waitUntil(capture);
}

// The backups section's data: null where the server has no backups to show (spoonjoy.app), or why
// the server couldn't list them.
async function loadBackups(context: Context, request: Request, userId: string): Promise<ServerBackups | { error: string } | null> {
  const host = serverBackups(context.cloudflare?.env);
  if (!host) return null;
  try {
    return await host.list();
  } catch (error) {
    reportBackupFailure(context, request, userId, error, "list");
    return { error: reason(error) };
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, db, userId } = await requireAdmin(request, context);
  const invites = await listServerInvites(db);
  return {
    signups: await signupMode(db, env),
    invites: invites.map((invite) => ({ id: invite.id, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() })),
    ai: await serverAi(db, env),
    backups: await loadBackups(context, request, userId),
  };
}

export type ServerSettingsActionData =
  | { intent: string; success: true; link?: string; made?: BackupMade; restored?: BackupRestored }
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
    case "ai": {
      const provider = String(form.get("provider")) as AiProvider;
      if (!AI_PROVIDERS.includes(provider)) return fail("Choose OpenAI, Gemini or no AI.", 400);
      const refused = await setServerAi(db, env, { provider, key: String(form.get("key") ?? "") }, requestD1(context));
      if (refused) return fail(refused, 400);
      return data<ServerSettingsActionData>({ intent, success: true });
    }
    case "backup":
    case "restore": {
      const host = serverBackups(env);
      if (!host) return fail("This server has no backups.", 404);
      try {
        if (intent === "backup") return data<ServerSettingsActionData>({ intent, success: true, made: await host.backUpNow() });
        return data<ServerSettingsActionData>({ intent, success: true, restored: await host.restore(String(form.get("name") ?? "")) });
      } catch (error) {
        reportBackupFailure(context, request, userId, error, intent);
        return fail(reason(error), error instanceof ServerBackupError ? error.status : 500);
      }
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

const AI_NAMES: Record<AiProvider, string> = { off: "No AI", openai: "OpenAI", gemini: "Gemini" };

const AI_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "off", label: "No AI", description: "Ingredients are read by the built-in parser, and recipes get no drawn covers." },
];

function AiChoice({ ai }: { ai: Awaited<ReturnType<typeof loader>>["ai"] }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  const [provider, setProvider] = useState<string>(ai.provider);
  const reply = fetcher.state === "idle" ? fetcher.data : undefined;
  const failure = reply && !reply.success ? reply.error : null;
  const keepsKey = ai.setBy === "admin" && provider === ai.provider;
  return (
    <section className="mt-10" aria-labelledby="server-ai" data-testid="server-ai">
      <SectionHeader id="server-ai" title="AI" level={2} />
      <Text className="mt-2" data-testid="server-ai-provider">{AI_NAMES[ai.provider]}</Text>
      <Text tone="muted" size="sm" className="mt-1">
        {ai.setBy === "env"
          ? "The key this server was started with picks this. Choose here to use your own instead."
          : ai.setBy === "default"
            ? "No AI key is set, so this server doesn't use AI."
            : ai.provider === "off"
              ? "You turned AI off."
              : "With the key you saved here."}
      </Text>
      <fetcher.Form method="post" className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="intent" value="ai" />
        <RadioGroup legend="Use" description="AI reads ingredients and imported recipes, and draws recipe covers." name="provider" options={AI_OPTIONS} value={provider} onValueChange={setProvider} />
        {provider === "off" ? null : (
          <TextField
            key={provider}
            label={`${AI_NAMES[provider as AiProvider]} API key`}
            name="key"
            type="password"
            autoComplete="off"
            required={!keepsKey}
            description={keepsKey ? "Leave it empty to keep the saved key." : "It's kept on this server, and in its backups."}
          />
        )}
        {failure ? <Text role="alert" tone="destructive" size="sm">{failure}</Text> : null}
        {reply?.success && reply.intent === "ai" ? <Text role="status" size="sm">Saved.</Text> : null}
        <div>
          <Button type="submit" variant="outline" disabled={fetcher.state !== "idle"}>
            {fetcher.state === "idle" ? "Save" : "Saving..."}
          </Button>
        </div>
      </fetcher.Form>
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

const BACKUP_KINDS: Record<ServerBackup["kind"], string> = {
  auto: "Scheduled",
  manual: "Made here",
  "before-restore": "Saved before a restore",
};

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function scheduleText({ schedule, keep }: ServerBackups) {
  if (!schedule) return "Scheduled backups are off: SPOONJOY_BACKUP_SCHEDULE is set to off where the server is started.";
  const when = schedule === "17 3 * * *" ? "every day at 03:17 UTC" : `on the schedule ${schedule} (UTC)`;
  return `The server backs itself up ${when} and keeps the last ${keep} scheduled backups. Backups made here, and those saved before a restore, stay until you remove them from the backups folder.`;
}

function BackupRow({ backup }: { backup: ServerBackup }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  const failure = fetcher.data && !fetcher.data.success ? fetcher.data.error : null;
  const restored = fetcher.data?.success ? fetcher.data.restored : undefined;
  return (
    <li className="py-3" data-testid="server-backup">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text size="sm">
          {BACKUP_KINDS[backup.kind]}, <LocalDate value={backup.createdAt} />, {size(backup.size)}
        </Text>
        <div className="flex flex-wrap gap-2">
          <Button href={`/account/server/backups/${encodeURIComponent(backup.name)}`} variant="outline" size="sm" download={backup.name}>
            Download
          </Button>
          <ConfirmDialog
            trigger={<Button type="button" variant="outline" tone="destructive" size="sm" disabled={fetcher.state !== "idle"}>Restore</Button>}
            title="Restore this backup?"
            description="Everything on this server, its accounts, recipes, cookbooks and photos, goes back to how it was when this backup was made. The server backs up what's here first, so you can undo it."
            confirmLabel="Restore"
            tone="destructive"
            onConfirm={() => fetcher.submit({ intent: "restore", name: backup.name }, { method: "post" })}
          />
        </div>
      </div>
      {failure ? <Text role="alert" tone="destructive" size="sm" className="mt-2">{failure}</Text> : null}
      {restored ? (
        <Text role="status" size="sm" className="mt-2" data-testid="server-backup-restored">
          Restored this backup.{restored.savedFirst ? " What was here before is saved as the newest backup above." : null}
        </Text>
      ) : null}
    </li>
  );
}

function Backups({ backups }: { backups: Awaited<ReturnType<typeof loader>>["backups"] }) {
  const fetcher = useFetcher<ServerSettingsActionData>();
  if (!backups) return null;
  const made = fetcher.data?.success ? fetcher.data.made : undefined;
  const failure = fetcher.data && !fetcher.data.success ? fetcher.data.error : null;
  return (
    <section className="mt-10" aria-labelledby="server-backups" data-testid="server-backups">
      <SectionHeader id="server-backups" title="Backups" level={2} />
      {"error" in backups ? (
        <Text role="alert" tone="destructive" size="sm" className="mt-2">The server couldn't list its backups: {backups.error}</Text>
      ) : (
        <>
          <Text tone="muted" size="sm" className="mt-2">{scheduleText(backups)}</Text>
          <Button type="button" className="mt-3" disabled={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "backup" }, { method: "post" })}>
            {fetcher.state === "idle" ? "Back up now" : "Backing up..."}
          </Button>
          {made ? <Text role="status" size="sm" className="mt-2">Backed up {made.rows} rows and {made.photos} photos.</Text> : null}
          {failure ? <Text role="alert" tone="destructive" size="sm" className="mt-2">{failure}</Text> : null}
          {backups.backups.length > 0 ? (
            <ul className="mt-6 divide-y divide-[var(--sj-border)]" aria-label="Backups">
              {backups.backups.map((backup) => <BackupRow key={backup.name} backup={backup} />)}
            </ul>
          ) : (
            <Text size="sm" className="mt-4">No backups yet.</Text>
          )}
        </>
      )}
    </section>
  );
}

export default function ServerSettings() {
  const { signups, invites, ai, backups } = useLoaderData<typeof loader>();
  return (
    <CookbookPage>
      <PageHeader
        eyebrow="Server settings"
        title="This server"
        size="lg"
        divider
        description={
          <>
            You made this server's first account, so you decide who else can join it, which AI it uses, and look after its backups. You can also{" "}
            <Link href="/moderation">review open reports</Link>.
          </>
        }
      />
      <SignupsSwitch signups={signups} />
      <Invites invites={invites} />
      <AiChoice ai={ai} />
      <Backups backups={backups} />
    </CookbookPage>
  );
}
