// @vitest-environment node
// Node environment: happy-dom's Response drops Set-Cookie, and these tests read the cookie back.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { faker } from "@faker-js/faker";
import { getLocalDb } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { getSessionSignIn } from "~/lib/session.server";
import { action as loginAction } from "~/routes/login";
import { action as signupAction } from "~/routes/signup";
import { cleanupDatabase } from "../helpers/cleanup";

function post(path: string, fields: Record<string, string>) {
  return new UndiciRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }) as unknown as Request;
}

function signInOf(response: Response) {
  return getSessionSignIn(new UndiciRequest("http://localhost:3000/", {
    headers: { Cookie: (response.headers.get("Set-Cookie") ?? "").split(";")[0] },
  }) as unknown as Request);
}

describe("password sign-in method", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("records a password sign-in as the session's method, with a new sign-in time", async () => {
    const password = "testPassword123";
    const user = await createUser(await getLocalDb(), faker.internet.email(), `pw_${faker.string.alphanumeric(10)}`, password);
    const before = Date.now();

    const response = await loginAction({ request: post("/login", { identifier: user.username, password }), context: { cloudflare: { env: null } }, params: {} } as any) as Response;

    expect(response.status).toBe(302);
    const signIn = await signInOf(response);
    expect(signIn.signInMethod).toBe("password");
    expect(signIn.authenticatedAt).toBeGreaterThanOrEqual(before);
  });

  it("records a new account's sign-up, made with a password, as a password sign-in", async () => {
    const password = "Valid-Test-Password-42!";
    const response = await signupAction({
      request: post("/signup", { email: faker.internet.email(), username: `su_${faker.string.alphanumeric(10)}`, password, confirmPassword: password }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any) as Response;

    expect(response.status).toBe(302);
    await expect(signInOf(response)).resolves.toMatchObject({ signInMethod: "password" });
  });
});
