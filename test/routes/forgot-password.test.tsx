import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub, requiredLabel } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import ForgotPassword, { action, loader, meta } from "~/routes/forgot-password";
import { cleanupDatabase } from "../helpers/cleanup";

const QA_ENV = { SPOONJOY_EMAIL_MODE: "capture", SPOONJOY_BASE_URL: "http://localhost:3000" };

function unwrap(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status ?? 200 };
  }
  return { data: response, status: 200 };
}

async function submit(fields: Record<string, string>, env: Record<string, unknown> = QA_ENV, ctx?: { waitUntil: (p: Promise<unknown>) => void }) {
  const form = new UndiciFormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const request = new UndiciRequest("http://localhost:3000/forgot-password", { method: "POST", body: form });
  return unwrap(await action({ request, context: { cloudflare: { env, ctx } }, params: {} } as any));
}

describe("forgot-password route", () => {
  let email: string;

  beforeEach(async () => {
    await cleanupDatabase();
    email = `codex_e2e_forgot_${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
    await createUser(db, email, `chef_${faker.string.alphanumeric(8)}`, "old-password-1");
  });

  afterEach(async () => {
    cleanup();
    await db.emailOutbox.deleteMany({ where: { toAddress: email } });
    await cleanupDatabase();
  });

  it("titles the page", () => {
    expect(meta({} as any)[0]).toEqual({ title: "Reset your password - Spoonjoy" });
  });

  it("says whether reset mail is available here", async () => {
    expect(await loader({ request: new UndiciRequest("http://localhost:3000/forgot-password"), context: { cloudflare: { env: QA_ENV } }, params: {} } as any))
      .toEqual({ available: true });
    expect(await loader({ request: new UndiciRequest("http://localhost:3000/forgot-password"), context: {}, params: {} } as any))
      .toEqual({ available: false });
  });

  it("answers a known and an unknown address the same way, and mails only the known one", async () => {
    const known = await submit({ email: ` ${email.toUpperCase()} ` });
    const unknown = await submit({ email: "nobody-here@example.com" });
    expect(known).toEqual({ status: 200, data: { sent: true, email: email.toUpperCase() } });
    expect(unknown).toEqual({ status: 200, data: { sent: true, email: "nobody-here@example.com" } });
    expect(await db.emailOutbox.count({ where: { toAddress: email } })).toBe(1);
    expect(await db.emailOutbox.count({ where: { toAddress: "nobody-here@example.com" } })).toBe(0);
  });

  it("does the lookup and the mail after the response on Workers", async () => {
    const pending: Promise<unknown>[] = [];
    const result = await submit({ email }, QA_ENV, { waitUntil: (promise) => pending.push(promise) });
    expect(result.data).toEqual({ sent: true, email });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(await db.emailOutbox.count({ where: { toAddress: email } })).toBe(1);
  });

  it("still answers the same when the background work fails", async () => {
    const pending: Promise<unknown>[] = [];
    const env = { ...QA_ENV, SPOONJOY_BASE_URL: "http://localhost:3000" };
    const spy = vi.spyOn(db.accountEmailToken, "count").mockRejectedValueOnce(new Error("boom"));
    const result = await submit({ email }, env, { waitUntil: (promise) => pending.push(promise) });
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(result.data).toEqual({ sent: true, email });
    spy.mockRestore();
  });

  it("asks for an email address", async () => {
    expect(await submit({ email: "" })).toEqual({ status: 400, data: { errors: { email: "Enter the email address of your account" } } });
    expect(await submit({})).toEqual({ status: 400, data: { errors: { email: "Enter the email address of your account" } } });
    expect((await submit({ email: "not-an-address" })).status).toBe(400);
  });

  it("says so where mail can't be sent", async () => {
    expect(await submit({ email }, {})).toEqual({ status: 503, data: { errors: { general: "Password reset by email isn't available right now." } } });
  });

  it("is rate limited per IP", async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const result = await submit({ email }, { ...QA_ENV, AUTH_IP_RATE_LIMITER: limiter });
    expect(result).toEqual({ status: 429, data: { errors: { general: "Too many attempts. Please wait a moment and try again." } } });
    expect(await db.emailOutbox.count({ where: { toAddress: email } })).toBe(0);
  });

  describe("page", () => {
    it("asks for the email, then shows the same answer whatever was typed", async () => {
      const Stub = createTestRoutesStub([
        { path: "/forgot-password", Component: ForgotPassword, loader: () => ({ available: true }), action: () => ({ sent: true, email: "someone@example.com" }) },
      ]);
      render(<Stub initialEntries={["/forgot-password"]} />);
      const field = await screen.findByLabelText(requiredLabel("Email"));
      expect(field).toHaveAttribute("autocomplete", "email");
      await userEvent.type(field, "someone@example.com");
      await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
      expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
      expect(screen.getByText("If an account uses that email, a reset link is on its way.")).toBeInTheDocument();
      expect(screen.getByText(/We sent it to someone@example.com/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to log in" })).toHaveAttribute("href", "/login");
    });

    it("shows the action's message on the field", async () => {
      const Stub = createTestRoutesStub([
        { path: "/forgot-password", Component: ForgotPassword, loader: () => ({ available: true }), action: () => ({ errors: { email: "Enter the email address of your account" } }) },
      ]);
      render(<Stub initialEntries={["/forgot-password"]} />);
      await userEvent.type(await screen.findByLabelText(requiredLabel("Email")), "x@y");
      await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
      expect(await screen.findByText("Enter the email address of your account")).toBeInTheDocument();
    });

    it("explains the other ways back in where mail can't be sent", async () => {
      const Stub = createTestRoutesStub([{ path: "/forgot-password", Component: ForgotPassword, loader: () => ({ available: false }) }]);
      render(<Stub initialEntries={["/forgot-password"]} />);
      expect(await screen.findByText("Password reset by email isn't available right now.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send reset link" })).toBeNull();
    });
  });
});
