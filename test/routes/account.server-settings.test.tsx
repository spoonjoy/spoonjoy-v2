import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { gateAccountCreation, serverInviteStatus, signupMode } from "~/lib/server-access.server";
import ServerSettings, { action, loader, meta } from "~/routes/account.server-settings";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub, createTestUser } from "../utils";

const selfHosted = { SPOONJOY_SELF_HOSTED: "true", SPOONJOY_BASE_URL: "https://kitchen.example.com" };

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
    expect(await load(admin.cookie)).toEqual({ signups: { mode: "invite", setBy: "default" }, invites: [] });
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
        loader: () => ({ signups: { mode: "invite", setBy: "default" }, invites: [] }),
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
      { signups: { mode: "open", setBy: "admin" }, invites: [] },
      () => ({ intent: "signups", success: false, error: "Something went wrong." }),
    );
    expect(await screen.findByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Anyone who can reach this server can make an account.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make invite-only" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(Object.fromEntries(submitted[0]!)).toEqual({ intent: "signups", mode: "invite" });
  });

  it("opens sign-ups from the page", async () => {
    const submitted = renderPage({ signups: { mode: "invite", setBy: "default" }, invites: [] }, () => ({ intent: "signups", success: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Open sign-ups" }));
    await expect.poll(() => submitted.map((form) => Object.fromEntries(form))).toEqual([{ intent: "signups", mode: "open" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open sign-ups" })).toBeEnabled());
  });

  it("hides the switch when SPOONJOY_SIGNUPS decides", async () => {
    renderPage({ signups: { mode: "invite", setBy: "env" }, invites: [] }, () => ({}));
    expect(await screen.findByText(/SPOONJOY_SIGNUPS sets this where the server is started\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open sign-ups" })).not.toBeInTheDocument();
  });

  it("makes a link to copy, and revokes a listed one", async () => {
    const submitted = renderPage(
      {
        signups: { mode: "invite", setBy: "default" },
        invites: [{ id: "invite-1", createdAt: "2026-11-20T10:00:00.000Z", expiresAt: "2026-11-27T10:00:00.000Z" }],
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
});
