import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub, requiredLabel } from "../utils";
import { db } from "~/lib/db.server";
import { createUser, verifyStoredPassword } from "~/lib/auth.server";
import { requestPasswordReset } from "~/lib/password-reset.server";
import ResetPassword, { action, loader, meta } from "~/routes/reset-password";
import { cleanupDatabase } from "../helpers/cleanup";

const QA_ENV = { SPOONJOY_EMAIL_MODE: "capture", SPOONJOY_BASE_URL: "http://localhost:3000" };
const NEW_PASSWORD = "brand-new-password-1";

function unwrap(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status ?? 200 };
  }
  return { data: response, status: 200 };
}

describe("reset-password route", () => {
  let email: string;
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    email = `codex_e2e_reset_${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
    userId = (await createUser(db, email, `chef_${faker.string.alphanumeric(8)}`, "old-password-1")).id;
  });

  afterEach(async () => {
    cleanup();
    await db.emailOutbox.deleteMany({ where: { toAddress: email } });
    await cleanupDatabase();
  });

  async function mailedToken(): Promise<string> {
    await requestPasswordReset(db, QA_ENV, email);
    const mail = await db.emailOutbox.findFirstOrThrow({ where: { toAddress: email }, orderBy: { createdAt: "desc" } });
    return /token=([A-Za-z0-9_-]+)/.exec(mail.textBody)![1];
  }

  const load = (search: string) =>
    loader({ request: new UndiciRequest(`http://localhost:3000/reset-password${search}`), context: {}, params: {} } as any);

  async function submit(fields: Record<string, string>, env: Record<string, unknown> = {}) {
    const form = new UndiciFormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    const request = new UndiciRequest("http://localhost:3000/reset-password", { method: "POST", body: form });
    return unwrap(await action({ request, context: { cloudflare: { env } }, params: {} } as any));
  }

  it("keeps the token in the address away from other sites", () => {
    expect(meta({} as any)).toContainEqual({ name: "referrer", content: "no-referrer" });
  });

  it("shows the form only for a usable link", async () => {
    const token = await mailedToken();
    expect(await load(`?token=${token}`)).toEqual({ state: "form", token });
    expect(await load("?token=nope")).toEqual({ state: "invalid" });
    expect(await load("")).toEqual({ state: "invalid" });
  });

  it("resets the password once, and refuses the link afterwards", async () => {
    const token = await mailedToken();
    expect(await submit({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).toEqual({ status: 200, data: { state: "done" } });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyStoredPassword(NEW_PASSWORD, user)).toBe(true);
    expect(user.sessionVersion).toBe(1);

    expect(await submit({ token, password: "another-password-1", confirmPassword: "another-password-1" })).toEqual({ status: 400, data: { state: "invalid" } });
    expect(await load(`?token=${token}`)).toEqual({ state: "invalid" });
  });

  it("puts password problems on the fields", async () => {
    const token = await mailedToken();
    expect(await submit({ token, password: "short", confirmPassword: "short" }))
      .toEqual({ status: 400, data: { state: "form", errors: { password: "Password must be at least 8 characters" } } });
    expect(await submit({})).toEqual({ status: 400, data: { state: "invalid" } });
  });

  it("is rate limited per IP", async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    expect((await submit({ token: "x" }, { AUTH_IP_RATE_LIMITER: limiter })).status).toBe(429);
  });

  async function fillAndSubmit() {
    await userEvent.type(await screen.findByLabelText(requiredLabel("New password")), NEW_PASSWORD);
    await userEvent.type(screen.getByLabelText(requiredLabel("Confirm new password")), NEW_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  }

  describe("page", () => {
    it("takes the new password and then shows the way to log in", async () => {
      const Stub = createTestRoutesStub([
        { path: "/reset-password", Component: ResetPassword, loader: () => ({ state: "form", token: "tok" }), action: () => ({ state: "done" }) },
      ]);
      render(<Stub initialEntries={["/reset-password?token=tok"]} />);
      const password = await screen.findByLabelText(requiredLabel("New password"));
      expect(password).toHaveAttribute("autocomplete", "new-password");
      await fillAndSubmit();
      expect(await screen.findByText("Your password has been reset.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    });

    it("shows field errors and keeps the form", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/reset-password",
          Component: ResetPassword,
          loader: () => ({ state: "form", token: "tok" }),
          action: () => ({ state: "form", errors: { confirmPassword: "Passwords do not match" } }),
        },
      ]);
      render(<Stub initialEntries={["/reset-password?token=tok"]} />);
      await fillAndSubmit();
      expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
      expect(screen.getByLabelText(requiredLabel("Confirm new password"))).toBeInTheDocument();
    });

    it("explains an expired or used link and offers a new one", async () => {
      const Stub = createTestRoutesStub([{ path: "/reset-password", Component: ResetPassword, loader: () => ({ state: "invalid" }) }]);
      render(<Stub initialEntries={["/reset-password?token=old"]} />);
      expect(await screen.findByText("This reset link has expired or was already used.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
    });

    it("shows the expired state when the link was used up during the submit", async () => {
      const Stub = createTestRoutesStub([
        { path: "/reset-password", Component: ResetPassword, loader: () => ({ state: "form", token: "tok" }), action: () => ({ state: "invalid" }) },
      ]);
      render(<Stub initialEntries={["/reset-password?token=tok"]} />);
      await fillAndSubmit();
      expect(await screen.findByText("This reset link has expired or was already used.")).toBeInTheDocument();
    });

    it("shows the expired state when a form answer arrives for a link that is no longer usable", async () => {
      let usable = true;
      const Stub = createTestRoutesStub([
        {
          path: "/reset-password",
          Component: ResetPassword,
          loader: () => (usable ? { state: "form", token: "tok" } : { state: "invalid" }),
          action: () => {
            usable = false;
            return { state: "form", errors: { general: "Too many attempts. Please wait a moment and try again." } };
          },
        },
      ]);
      render(<Stub initialEntries={["/reset-password?token=tok"]} />);
      await fillAndSubmit();
      expect(await screen.findByText("This reset link has expired or was already used.")).toBeInTheDocument();
    });
  });
});
