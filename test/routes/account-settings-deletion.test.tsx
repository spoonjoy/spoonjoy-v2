import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createTestRoutesStub } from "../utils";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { DELETE_ACCOUNT_REAUTH_REDIRECT } from "~/lib/account-settings.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1, type SqliteD1 } from "../helpers/sqlite-d1";

const mocked = vi.hoisted(() => ({ db: null as PrismaClientType | null }));

vi.mock("~/lib/route-platform.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/route-platform.server")>()),
  getRequestDb: vi.fn(async () => mocked.db!),
}));

const { default: AccountSettings, action } = await import("~/routes/account.settings");
const { loader: exportLoader } = await import("~/routes/account.export");
const { default: AccountDeleted, meta: deletedMeta } = await import("~/routes/account.deleted");

const PASSWORD = "testPassword123";
const MINUTE = 60_000;
let db: PrismaClientType;
let d1: SqliteD1;

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

async function postAction(cookie: string, fields: Record<string, string>, env: Record<string, unknown> | null = { DB: d1.binding }) {
  const request = new UndiciRequest("http://localhost:3000/account/settings", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  try {
    return await action({ request, context: { cloudflare: { env } }, params: {} } as any);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

async function passwordChef() {
  const user = await createUser(db, faker.internet.email(), `chef_${faker.string.alphanumeric(8)}`, PASSWORD);
  return { user, cookie: cookiePair(await createUserSessionCookie(user.id)) };
}

async function passwordlessChef(signedInAt: number) {
  const user = await db.user.create({
    data: {
      email: faker.internet.email(),
      username: `oauth_${faker.string.alphanumeric(8)}`,
      OAuth: { create: { provider: "github", providerUserId: faker.string.alphanumeric(10), providerUsername: "gh" } },
    },
  });
  return { user, cookie: cookiePair(await createUserSessionCookie(user.id, null, null, { authenticatedAt: signedInAt })) };
}

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
  mocked.db = db;
  d1 = sqliteD1();
});

afterEach(async () => {
  d1.close();
  await cleanupDatabase();
});

describe("Account settings - delete account", () => {
  it("deletes a password account after the username and password, signs out, and shows the goodbye page", async () => {
    const { user, cookie } = await passwordChef();
    await db.recipe.create({ data: { title: "Toast", chefId: user.id } });

    const response = (await postAction(cookie, { intent: "deleteAccount", confirmUsername: ` ${user.username} `, password: PASSWORD })) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/account/deleted");
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
    await expect(db.recipe.count({ where: { chefId: user.id } })).resolves.toBe(0);
  });

  it("refuses the wrong username or password and keeps the account", async () => {
    const { user, cookie } = await passwordChef();

    await expect(postAction(cookie, { intent: "deleteAccount", confirmUsername: "someone", password: PASSWORD })).resolves.toEqual({
      success: false,
      intent: "deleteAccount",
      error: "confirmation_mismatch",
      message: "Type your username exactly to confirm.",
    });
    await expect(postAction(cookie, { intent: "deleteAccount" })).resolves.toMatchObject({ error: "confirmation_mismatch" });
    await expect(postAction(cookie, { intent: "deleteAccount", confirmUsername: user.username, password: "wrong" }))
      .resolves.toMatchObject({ intent: "deleteAccount", error: "password_incorrect" });
    await expect(postAction(cookie, { intent: "deleteAccount", confirmUsername: user.username }))
      .resolves.toMatchObject({ error: "password_required" });
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });

  it("lets a passwordless account delete only within ten minutes of signing in", async () => {
    const stale = await passwordlessChef(Date.now() - 11 * MINUTE);
    await expect(postAction(stale.cookie, { intent: "deleteAccount", confirmUsername: stale.user.username }))
      .resolves.toMatchObject({ error: "recent_sign_in_required" });
    await expect(db.user.findUnique({ where: { id: stale.user.id } })).resolves.not.toBeNull();

    const fresh = await passwordlessChef(Date.now() - MINUTE);
    const response = (await postAction(fresh.cookie, { intent: "deleteAccount", confirmUsername: fresh.user.username })) as Response;
    expect(response.headers.get("Location")).toBe("/account/deleted");
    await expect(db.user.findUnique({ where: { id: fresh.user.id } })).resolves.toBeNull();
  });

  it("signs a passwordless chef out and back in to the deletion form", async () => {
    const { cookie } = await passwordlessChef(Date.now() - 11 * MINUTE);
    const response = (await postAction(cookie, { intent: "reauthenticate" })) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(DELETE_ACCOUNT_REAUTH_REDIRECT);
    expect(DELETE_ACCOUNT_REAUTH_REDIRECT).toBe("/login?redirectTo=%2Faccount%2Fsettings%23delete-account");
  });

  it("is rate limited, and needs the D1 binding", async () => {
    const { user, cookie } = await passwordChef();
    const fields = { intent: "deleteAccount", confirmUsername: user.username, password: PASSWORD };

    await expect(postAction(cookie, fields, { DB: d1.binding, AUTH_IP_RATE_LIMITER: { limit: async () => ({ success: false }) } }))
      .resolves.toMatchObject({ error: "rate_limited" });
    await expect(postAction(cookie, fields, null)).rejects.toThrow("Account deletion needs the D1 database binding");
    await expect(db.user.findUnique({ where: { id: user.id } })).resolves.not.toBeNull();
  });
});

describe("Account export download", () => {
  it("downloads the signed-in chef's data as a JSON file", async () => {
    const { user, cookie } = await passwordChef();
    await db.recipe.create({ data: { title: "Toast", chefId: user.id } });
    const request = new UndiciRequest("http://localhost:3000/account/export", { headers: { Cookie: cookie } }) as unknown as Request;

    const response = await exportLoader({ request, context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } }, params: {} } as any);

    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="spoonjoy-chef_[A-Za-z0-9]+-\d{4}-\d{2}-\d{2}\.json"$/);
    const exported = JSON.parse(await response.text());
    expect(exported).toMatchObject({ account: { id: user.id }, recipes: [{ title: "Toast", url: expect.stringMatching(/^https:\/\/spoonjoy\.app\/recipes\//) }] });
  });

  it("sends a signed-out visitor to sign in, and falls back to the production origin", async () => {
    const signedOut = new UndiciRequest("http://localhost:3000/account/export") as unknown as Request;
    await expect(exportLoader({ request: signedOut, context: { cloudflare: { env: null } }, params: {} } as any)).rejects.toMatchObject({ status: 302 });

    const { user, cookie } = await passwordChef();
    await db.recipe.create({ data: { title: "Toast", chefId: user.id } });
    const request = new UndiciRequest("http://localhost:3000/account/export", { headers: { Cookie: cookie } }) as unknown as Request;
    const response = await exportLoader({ request, context: { cloudflare: { env: null } }, params: {} } as any);
    expect(JSON.parse(await response.text()).recipes[0].url).toMatch(/^https:\/\/spoonjoy\.app\//);
  });
});

describe("Account deleted page", () => {
  it("confirms the deletion and keeps the page out of search", async () => {
    expect(deletedMeta({} as any)).toEqual([{ title: "Account deleted - Spoonjoy" }, { name: "robots", content: "noindex" }]);
    const Stub = createTestRoutesStub([{ path: "/account/deleted", Component: AccountDeleted }]);
    render(<Stub initialEntries={["/account/deleted"]} />);
    expect(await screen.findByRole("heading", { name: "Your account is deleted" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a new account" })).toHaveAttribute("href", "/signup");
  });
});

describe("Account settings - Your data section", () => {
  function renderSettings(hasPassword: boolean, result: Record<string, unknown> | null, onAction: (fields: Record<string, string>) => void) {
    const loaderData = {
      user: { id: "u1", email: "ada@example.com", username: "ada", hasPassword, oauthAccounts: [{ provider: "github", providerUsername: "ada" }], photoUrl: null, passkeys: [] },
      notifications: { pushSubscribed: false, preferences: {} },
    };
    const Stub = createTestRoutesStub([
      {
        path: "/account/settings",
        Component: AccountSettings,
        loader: () => loaderData,
        action: async ({ request }) => {
          onAction(Object.fromEntries((await request.formData()).entries()) as Record<string, string>);
          return result;
        },
      },
    ]);
    render(<Stub initialEntries={["/account/settings"]} />);
  }

  it("offers the download, and deletion only after the username is typed", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings(true, { success: false, intent: "deleteAccount", error: "password_incorrect", message: "That password isn't right." }, (f) => posted.push(f));

    expect(await screen.findByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/account/export");
    expect(screen.getByRole("link", { name: "What gets deleted" })).toHaveAttribute("href", "/privacy#deletion");
    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    const submit = screen.getByRole("button", { name: "Delete my account" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Type your username, ada, to confirm"), "ada");
    await user.type(screen.getByLabelText("Current password"), "nope");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(await screen.findByText("That password isn't right.")).toBeInTheDocument();
    expect(posted).toEqual([{ intent: "deleteAccount", confirmUsername: "ada", password: "nope" }]);
    // The error shows in the form, not in the page banner.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Delete my account" })).not.toBeInTheDocument();
  });

  it("asks a passwordless chef for a recent sign-in and offers to sign in again", async () => {
    const user = userEvent.setup();
    const posted: Array<Record<string, string>> = [];
    renderSettings(false, { success: false, intent: "deleteAccount", error: "recent_sign_in_required", message: "For your safety, sign in again, then delete your account within 10 minutes." }, (f) => posted.push(f));

    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    // Neutral guidance before any attempt, and no error yet.
    expect(screen.getByText(/signed in within the last 10 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Type your username, ada, to confirm"), "ada");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    // A failed attempt's message replaces the guidance.
    expect(await screen.findByRole("alert")).toHaveTextContent("For your safety, sign in again");
    expect(screen.queryByText(/signed in within the last 10 minutes/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(posted.map((f) => f.intent)).toEqual(["deleteAccount", "reauthenticate"]);
  });
});
