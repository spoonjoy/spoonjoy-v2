import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { gateAccountCreation, serverInviteStatus, signupMode } from "~/lib/server-access.server";
import ServerSettings, { action, loader, meta } from "~/routes/account.server";
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
});
