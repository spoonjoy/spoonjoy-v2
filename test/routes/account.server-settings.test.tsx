import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { gateAccountCreation, serverInviteStatus, signupMode } from "~/lib/server-access.server";
import ServerSettings, { action, loader, meta } from "~/routes/account.server-settings";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub, createTestUser } from "../utils";

const selfHosted = { SPOONJOY_SELF_HOSTED: "true", SPOONJOY_BASE_URL: "https://kitchen.example.com" };
const NO_AI = { provider: "off", setBy: "default" } as const;

async function chef(env: Record<string, string> = selfHosted) {
  // The first through the gate is the admin; later chefs are written straight to the database.
  const gate = await gateAccountCreation(db, env, { inviteToken: null });
  const user = await db.user.create({ data: createTestUser() });
  if (gate.allowed) await gate.created(user.id);
  return { user, cookie: (await createUserSessionCookie(user.id)).split(";")[0]! };
}

async function call<T>(run: () => Promise<T>): Promise<T | Response> {
  try {
    return await run();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

const load = (cookie: string, env: Record<string, string> = selfHosted) =>
  call(() =>
    loader({
      request: new UndiciRequest("http://localhost:3000/account/server", { headers: { Cookie: cookie } }),
      context: { cloudflare: { env } },
      params: {},
    } as never),
  );

const post = (cookie: string, fields: Record<string, string>, env: Record<string, string> = selfHosted) =>
  call(() =>
    action({
      request: new UndiciRequest("http://localhost:3000/account/server", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
      context: { cloudflare: { env } },
      params: {},
    } as never),
  );

interface ActionBody {
  intent?: string;
  success?: boolean;
  error?: string;
  link?: string;
}

function answer(result: unknown): { status: number; body: ActionBody } {
  if (result && typeof result === "object" && "init" in result && "data" in result) {
    const wrapped = result as { data: ActionBody; init: { status?: number } | null };
    return { status: wrapped.init?.status ?? 200, body: wrapped.data };
  }
  return { status: 200, body: result as ActionBody };
}

beforeEach(cleanupDatabase);
afterEach(async () => {
  cleanup();
  await cleanupDatabase();
});

describe("/account/server", () => {
  it("is not indexed", () => {
    expect(meta({} as never)).toEqual([{ title: "Server settings - Spoonjoy" }, { name: "robots", content: "noindex" }]);
  });

  it("is there only for a self-hosted server's admin", async () => {
    const admin = await chef();
    const other = await chef();
    expect(((await load(other.cookie)) as Response).status).toBe(404);
    expect(((await post(other.cookie, { intent: "invite" })) as Response).status).toBe(404);
    expect(((await load(admin.cookie, {})) as Response).status).toBe(404);
    expect(await load(admin.cookie)).toEqual({ signups: { mode: "invite", setBy: "default" }, invites: [], ai: NO_AI, backups: null });
  });

  it("lets the admin open sign-ups and close them again", async () => {
    const admin = await chef();
    expect(answer(await post(admin.cookie, { intent: "signups", mode: "open" }))).toEqual({ status: 200, body: { intent: "signups", success: true } });
    expect(await signupMode(db, selfHosted)).toEqual({ mode: "open", setBy: "admin" });
    await post(admin.cookie, { intent: "signups", mode: "invite" });
    expect(await signupMode(db, selfHosted)).toEqual({ mode: "invite", setBy: "admin" });
    expect(answer(await post(admin.cookie, { intent: "signups", mode: "sometimes" })).status).toBe(400);
  });

  it("says SPOONJOY_SIGNUPS decides, and keeps the switch, when the server sets it", async () => {
    const env = { ...selfHosted, SPOONJOY_SIGNUPS: "open" };
    const admin = await chef(env);
    expect(answer(await post(admin.cookie, { intent: "signups", mode: "invite" }, env))).toEqual({
      status: 409,
      body: { intent: "signups", success: false, error: "SPOONJOY_SIGNUPS sets this server's sign-ups to open. Change it where the server is started." },
    });
  });

  it("makes an invite link the admin copies, lists it, and revokes it", async () => {
    const admin = await chef();
    const made = answer(await post(admin.cookie, { intent: "invite" }));
    expect(made.status).toBe(200);
    expect(made.body.link).toMatch(/^https:\/\/kitchen\.example\.com\/signup\?invite=[A-Za-z0-9_-]{43}$/);
    const token = new URL(made.body.link!).searchParams.get("invite")!;
    expect(await serverInviteStatus(db, token)).toBe("valid");

    const listed = (await load(admin.cookie)) as { invites: Array<{ id: string }> };
    expect(listed.invites).toHaveLength(1);
    expect(answer(await post(admin.cookie, { intent: "revoke", inviteId: listed.invites[0].id })).body).toEqual({ intent: "revoke", success: true });
    expect(await serverInviteStatus(db, token)).toBe("revoked");
  });

  it("shows the switch and a fresh invite link to copy", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/account/server",
        Component: ServerSettings,
        loader: () => ({ signups: { mode: "invite", setBy: "default" }, invites: [], ai: NO_AI, backups: null }),
      },
    ]);
    render(<Stub initialEntries={["/account/server"]} />);
    expect(await screen.findByRole("heading", { name: "This server" })).toBeInTheDocument();
    expect(screen.getByText("Invite only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open sign-ups" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make an invite link" })).toBeInTheDocument();
  });
  it("refuses an action it doesn't know, and builds the link from the request when no base address is set", async () => {
    const env = { SPOONJOY_SELF_HOSTED: "true" };
    const admin = await chef(env);
    expect(answer(await post(admin.cookie, {}, env))).toEqual({ status: 400, body: { intent: "", success: false, error: "Unknown action." } });
    expect(answer(await post(admin.cookie, { intent: "invite" }, env)).body.link).toMatch(/^http:\/\/localhost:3000\/signup\?invite=/);
    expect(answer(await post(admin.cookie, { intent: "revoke" }, env)).body).toEqual({ intent: "revoke", success: true });
  });

  function renderPage(
    loaderData: Awaited<ReturnType<typeof loader>>,
    reply: (form: FormData) => Record<string, unknown>,
    submitted: FormData[] = [],
  ) {
    const Stub = createTestRoutesStub([
      {
        path: "/account/server",
        Component: ServerSettings,
        loader: () => loaderData,
        action: async ({ request }) => {
          const form = await request.formData();
          submitted.push(form);
          return reply(form);
        },
      },
    ]);
    render(<Stub initialEntries={["/account/server"]} />);
    return submitted;
  }

  it("turns sign-ups off from the page, and shows why it couldn't", async () => {
    const submitted = renderPage(
      { signups: { mode: "open", setBy: "admin" }, invites: [], ai: NO_AI, backups: null },
      () => ({ intent: "signups", success: false, error: "Something went wrong." }),
    );
    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Anyone who can reach this server can make an account.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make invite-only" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(Object.fromEntries(submitted[0]!)).toEqual({ intent: "signups", mode: "invite" });
  });

  it("opens sign-ups from the page", async () => {
    const submitted = renderPage({ signups: { mode: "invite", setBy: "default" }, invites: [], ai: NO_AI, backups: null }, () => ({ intent: "signups", success: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Open sign-ups" }));
    await expect.poll(() => submitted.map((form) => Object.fromEntries(form))).toEqual([{ intent: "signups", mode: "open" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open sign-ups" })).toBeEnabled());
  });

  it("hides the switch when SPOONJOY_SIGNUPS decides", async () => {
    renderPage({ signups: { mode: "invite", setBy: "env" }, invites: [], ai: NO_AI, backups: null }, () => ({}));
    expect(await screen.findByText(/SPOONJOY_SIGNUPS sets this where the server is started\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open sign-ups" })).not.toBeInTheDocument();
  });

  it("makes a link to copy, and revokes a listed one", async () => {
    const submitted = renderPage(
      {
        signups: { mode: "invite", setBy: "default" },
        invites: [{ id: "invite-1", createdAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-11-27T10:00:00.000Z" }],
        ai: NO_AI,
        backups: null,
      },
      (form) => form.get("intent") === "invite"
        ? { intent: "invite", success: true, link: "https://kitchen.example.com/signup?invite=abc" }
        : { intent: "revoke", success: true },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Make an invite link" }));
    expect(await screen.findByTestId("server-invite-link")).toHaveTextContent("https://kitchen.example.com/signup?invite=abc");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Invite links that still work" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await screen.findByRole("button", { name: "Revoke" });
    await expect.poll(() => submitted.map((form) => Object.fromEntries(form))).toEqual([
      { intent: "invite" },
      { intent: "revoke", inviteId: "invite-1" },
    ]);
  });
  describe("backups", () => {
    const NAME = "spoonjoy-manual-2026-11-23T10-00-00Z.tar.gz";
    const listing = {
      schedule: "17 3 * * *",
      keep: 7,
      backups: [
        { name: "spoonjoy-before-restore-2026-11-23T11-00-00Z.tar.gz", kind: "before-restore" as const, size: 3 * 1024 * 1024, createdAt: "2026-11-23T11:00:00Z" },
        { name: NAME, kind: "manual" as const, size: 200, createdAt: "2026-11-23T10:00:00Z" },
        { name: "spoonjoy-auto-2026-11-23T03-17-00Z.tar.gz", kind: "auto" as const, size: 650 * 1024, createdAt: "2026-11-23T03:17:00Z" },
      ],
    };
    function withHost(answer: (url: string, method: string) => Response) {
      const calls: string[] = [];
      const env = {
        ...selfHosted,
        SELF_HOST: {
          fetch: async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? "GET"} ${url}`);
            return answer(url, init?.method ?? "GET");
          },
        },
      } as never as Record<string, string>;
      return { env, calls };
    }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    it("lists the server's backups for its admin, or says why it couldn't", async () => {
      const { env } = withHost(() => json(listing));
      const admin = await chef(env);
      expect(((await load(admin.cookie, env)) as { backups: unknown }).backups).toEqual(listing);
      const broken = withHost(() => json({ error: "The backups folder isn't readable." }, 500));
      expect(((await load(admin.cookie, broken.env)) as { backups: unknown }).backups).toEqual({ error: "The backups folder isn't readable." });
      const thrown = { ...selfHosted, SELF_HOST: { fetch: async () => { throw "binding gone"; } } } as never as Record<string, string>;
      expect(((await load(admin.cookie, thrown)) as { backups: unknown }).backups).toEqual({ error: "binding gone" });
    });

    it("backs up now and restores a backup through the server", async () => {
      const { env, calls } = withHost((url) =>
        url.endsWith("/restore")
          ? json({ rows: 312, photos: 5, createdAt: "2026-11-23T10:00:00.000Z", savedFirst: "spoonjoy-before-restore-2026-11-23T11-00-00Z.tar.gz" })
          : json({ name: NAME, rows: 312, photos: 5 }),
      );
      const admin = await chef(env);
      expect(answer(await post(admin.cookie, { intent: "backup" }, env))).toEqual({
        status: 200,
        body: { intent: "backup", success: true, made: { name: NAME, rows: 312, photos: 5 } },
      });
      expect(answer(await post(admin.cookie, { intent: "restore", name: NAME }, env)).body).toEqual({
        intent: "restore",
        success: true,
        restored: { rows: 312, photos: 5, createdAt: "2026-11-23T10:00:00.000Z", savedFirst: "spoonjoy-before-restore-2026-11-23T11-00-00Z.tar.gz" },
      });
      await post(admin.cookie, { intent: "restore" }, env);
      expect(calls).toEqual([
        "POST http://self-host/backups",
        `POST http://self-host/backups/${NAME}/restore`,
        "POST http://self-host/backups//restore",
      ]);
    });

    it("passes on the server's refusal, and refuses where there are no backups", async () => {
      const { env } = withHost(() => json({ error: "A backup or restore is already running." }, 409));
      const admin = await chef(env);
      expect(answer(await post(admin.cookie, { intent: "backup" }, env))).toEqual({
        status: 409,
        body: { intent: "backup", success: false, error: "A backup or restore is already running." },
      });
      const thrown = { ...selfHosted, SELF_HOST: { fetch: async () => { throw new Error("binding gone"); } } } as never as Record<string, string>;
      expect(answer(await post(admin.cookie, { intent: "restore", name: NAME }, thrown))).toEqual({
        status: 500,
        body: { intent: "restore", success: false, error: "binding gone" },
      });
      expect(answer(await post(admin.cookie, { intent: "backup" }))).toEqual({
        status: 404,
        body: { intent: "backup", success: false, error: "This server has no backups." },
      });
    });

    function renderBackups(backups: Awaited<ReturnType<typeof loader>>["backups"], reply: (form: FormData) => Record<string, unknown> = () => ({})) {
      return renderPage({ signups: { mode: "invite", setBy: "default" }, invites: [], ai: NO_AI, backups }, reply);
    }

    it("shows the schedule and each backup with its kind, time and size, to download or restore", async () => {
      renderBackups(listing);
      expect(await screen.findByRole("heading", { name: "Backups" })).toBeInTheDocument();
      expect(screen.getByText(/backs itself up every day at 03:17 UTC and keeps the last 7 scheduled backups/)).toBeInTheDocument();
      const rows = screen.getAllByTestId("server-backup");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringMatching(/^Saved before a restore, .*, 3\.0 MB/),
        expect.stringMatching(/^Made here, .*, 1 KB/),
        expect.stringMatching(/^Scheduled, .*, 650 KB/),
      ]);
      const download = screen.getAllByRole("link", { name: "Download" })[1]!;
      expect(download).toHaveAttribute("href", `/account/server/backups/${NAME}`);
      expect(download).toHaveAttribute("download", NAME);
    });

    it("names a schedule it set from SPOONJOY_BACKUP_SCHEDULE, says when scheduled backups are off, and when there are none", async () => {
      renderBackups({ schedule: "0 */6 * * *", keep: 2, backups: [] });
      expect(await screen.findByText(/on the schedule 0 \*\/6 \* \* \* \(UTC\) and keeps the last 2/)).toBeInTheDocument();
      expect(screen.getByText("No backups yet.")).toBeInTheDocument();
      cleanup();
      renderBackups({ schedule: null, keep: 7, backups: [] });
      expect(await screen.findByText(/Scheduled backups are off/)).toBeInTheDocument();
    });

    it("says why the server couldn't list its backups, and shows nothing where there are none to have", async () => {
      renderBackups({ error: "The backups folder isn't readable." });
      expect(await screen.findByRole("alert")).toHaveTextContent("The server couldn't list its backups: The backups folder isn't readable.");
      expect(screen.queryByRole("button", { name: "Back up now" })).not.toBeInTheDocument();
      cleanup();
      renderBackups(null);
      await screen.findByRole("heading", { name: "This server" });
      expect(screen.queryByRole("heading", { name: "Backups" })).not.toBeInTheDocument();
    });

    it("backs up now from the page, and shows why it couldn't", async () => {
      let replies = 0;
      const submitted = renderBackups(listing, () =>
        replies++ === 0
          ? { intent: "backup", success: true, made: { name: NAME, rows: 312, photos: 5 } }
          : { intent: "backup", success: false, error: "A backup or restore is already running." },
      );
      await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Backed up 312 rows and 5 photos.");
      await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("A backup or restore is already running.");
      expect(submitted.map((form) => Object.fromEntries(form))).toEqual([{ intent: "backup" }, { intent: "backup" }]);
    });

    it("asks before restoring a backup, then says it's done and what it saved first", async () => {
      let replies = 0;
      const submitted = renderBackups(listing, () =>
        [
          { intent: "restore", success: true, restored: { rows: 312, photos: 5, createdAt: "2026-11-23T10:00:00Z", savedFirst: "spoonjoy-before-restore-x.tar.gz" } },
          { intent: "restore", success: true, restored: { rows: 0, photos: 0, createdAt: "2026-11-23T03:17:00Z", savedFirst: null } },
          { intent: "restore", success: false, error: "This backup comes from a newer Spoonjoy." },
        ][replies++]!,
      );
      const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
      await userEvent.click(restoreButtons[1]!);
      const dialog = await screen.findByRole("alertdialog", { name: "Restore this backup?" });
      expect(dialog).toHaveTextContent("The server backs up what's here first, so you can undo it.");
      await userEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
      expect(await screen.findByTestId("server-backup-restored")).toHaveTextContent("Restored this backup. What was here before is saved as the newest backup above.");

      await userEvent.click(screen.getAllByRole("button", { name: "Restore" })[2]!);
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore" }));
      await expect.poll(() => screen.getAllByTestId("server-backup-restored").map((note) => note.textContent)).toContain("Restored this backup.");

      await userEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]!);
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("This backup comes from a newer Spoonjoy.");
      expect(submitted.map((form) => Object.fromEntries(form))).toEqual([
        { intent: "restore", name: NAME },
        { intent: "restore", name: "spoonjoy-auto-2026-11-23T03-17-00Z.tar.gz" },
        { intent: "restore", name: "spoonjoy-before-restore-2026-11-23T11-00-00Z.tar.gz" },
      ]);
    });
  });
  describe("AI", () => {
    it("shows the AI in use and saves the admin's pick, refusing one without a key", async () => {
      const admin = await chef();
      expect(((await load(admin.cookie)) as { ai: unknown }).ai).toEqual(NO_AI);
      expect(answer(await post(admin.cookie, { intent: "ai", provider: "openai", key: "" }))).toEqual({
        status: 400,
        body: { intent: "ai", success: false, error: "Paste the server's OpenAI API key." },
      });
      expect(answer(await post(admin.cookie, { intent: "ai", provider: "off" }))).toEqual({ status: 200, body: { intent: "ai", success: true } });
      expect(answer(await post(admin.cookie, { intent: "ai" }))).toEqual({
        status: 400,
        body: { intent: "ai", success: false, error: "Choose OpenAI, Gemini or no AI." },
      });
      expect(answer(await post(admin.cookie, { intent: "ai", provider: "gemini", key: "g-synthetic" }))).toEqual({
        status: 200,
        body: { intent: "ai", success: true },
      });
      expect(((await load(admin.cookie)) as { ai: unknown }).ai).toEqual({ provider: "gemini", setBy: "admin" });
    });

    function renderAi(ai: Awaited<ReturnType<typeof loader>>["ai"], reply: (form: FormData) => Record<string, unknown> = () => ({})) {
      return renderPage({ signups: { mode: "invite", setBy: "default" }, invites: [], ai, backups: null }, reply);
    }

    it("says where the AI in use comes from", async () => {
      renderAi(NO_AI);
      expect(await screen.findByTestId("server-ai-provider")).toHaveTextContent("No AI");
      expect(screen.getByText("No AI key is set, so this server doesn't use AI.")).toBeInTheDocument();
      expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument();
      cleanup();
      renderAi({ provider: "openai", setBy: "env" });
      expect(await screen.findByText(/The key this server was started with picks this/)).toBeInTheDocument();
      expect(screen.getByLabelText("OpenAI API key")).toBeRequired();
      cleanup();
      renderAi({ provider: "off", setBy: "admin" });
      expect(await screen.findByText("You turned AI off.")).toBeInTheDocument();
      cleanup();
      renderAi({ provider: "gemini", setBy: "admin" });
      expect(await screen.findByText("With the key you saved here.")).toBeInTheDocument();
      expect(screen.getByLabelText("Gemini API key")).not.toBeRequired();
      expect(screen.getByText("Leave it empty to keep the saved key.")).toBeInTheDocument();
    });

    it("saves a provider with its key, and says why it couldn't", async () => {
      let replies = 0;
      const submitted = renderAi(NO_AI, () =>
        replies++ === 0 ? { intent: "ai", success: false, error: "Paste the server's OpenAI API key." } : { intent: "ai", success: true },
      );
      await userEvent.click(await screen.findByRole("radio", { name: "OpenAI" }));
      const key = screen.getByLabelText("OpenAI API key");
      expect(screen.getByText("It's kept on this server, and in its backups.")).toBeInTheDocument();
      await userEvent.type(key, "sk-synthetic");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Paste the server's OpenAI API key.");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("Saved.")).toHaveAttribute("role", "status");
      expect(submitted.map((form) => Object.fromEntries(form))).toEqual([
        { intent: "ai", provider: "openai", key: "sk-synthetic" },
        { intent: "ai", provider: "openai", key: "sk-synthetic" },
      ]);
    });
  });
});
