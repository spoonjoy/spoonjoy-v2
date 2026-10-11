// The sign-up form, the agent connection page and the OAuth consent screen when D1 stays
// unavailable through every retry: each answers a retryable 503 that says so, keeps what the chef
// typed, and passes on any other failure unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { faker } from "@faker-js/faker";
import { action as signupAction } from "~/routes/signup";
import { action as connectAction } from "~/routes/agent.connect.$requestId";
import { loader as authorizeLoader } from "~/routes/oauth.authorize";
import { startAgentConnection } from "~/lib/agent-connection.server";
import { D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import { getLocalDb } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { NETWORK_LOST_MESSAGE } from "../helpers/flaky-d1";
import { createTestUser } from "../utils";

const Request = UndiciRequest as unknown as typeof globalThis.Request;
const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const lost = () => Promise.reject(new Error(NETWORK_LOST_MESSAGE));

let db: Awaited<ReturnType<typeof getLocalDb>>;

beforeEach(async () => {
  await cleanupDatabase();
  db = await getLocalDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDatabase();
});

async function sessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

describe("signing up", () => {
  function signup() {
    const form = new UndiciFormData();
    form.set("email", "new-chef@example.com");
    form.set("username", `chef_${faker.string.alphanumeric(8)}`);
    form.set("password", "Valid-Test-Password-42!");
    form.set("confirmPassword", "Valid-Test-Password-42!");
    return signupAction({
      request: new UndiciRequest("http://localhost:3000/signup", { method: "POST", body: form }),
      context: { cloudflare: { env: null } },
      params: {},
    } as never);
  }

  it("answers a retryable 503 that keeps what was typed when the account cannot be saved", async () => {
    vi.spyOn(db.user, "create").mockImplementation(lost as never);

    const result = await signup() as unknown as { data: { errors: { general: string }; values: { email: string } }; init: ResponseInit };

    expect(result.init.status).toBe(503);
    expect(new Headers(result.init.headers).get("Retry-After")).toBe("1");
    expect(result.data.errors.general).toBe(D1_WRITE_UNAVAILABLE_MESSAGE);
    expect(result.data.values.email).toBe("new-chef@example.com");
  });

  it("passes on a failure that is not the database being unavailable", async () => {
    vi.spyOn(db.user, "create").mockRejectedValue(new Error("disk full"));

    await expect(signup()).rejects.toThrow("disk full");
  });
});

describe("approving an agent connection", () => {
  async function deny() {
    const user = await db.user.create({ data: createTestUser() });
    const started = await startAgentConnection(db, { now: new Date() });
    const form = new UndiciFormData();
    form.set("intent", "deny");
    form.set("userCode", started.request.userCode);
    const headers = new Headers({ Cookie: await sessionCookie(user.id) });
    return connectAction({
      request: new UndiciRequest(`http://localhost/agent/connect/${started.request.id}`, { method: "POST", body: form, headers }),
      params: { requestId: started.request.id },
      context: { cloudflare: { env: null } },
    } as never);
  }

  it("answers a retryable 503 the page shows when the decision cannot be saved", async () => {
    vi.spyOn(db.agentConnectionRequest, "update").mockImplementation(lost as never);

    const result = await deny() as unknown as { data: { error: string }; init: ResponseInit };

    expect(result.init.status).toBe(503);
    expect(new Headers(result.init.headers).get("Retry-After")).toBe("1");
    expect(result.data.error).toBe(D1_WRITE_UNAVAILABLE_MESSAGE);
  });

  it("passes on a failure that is not the database being unavailable", async () => {
    vi.spyOn(db.agentConnectionRequest, "update").mockRejectedValue(new Error("disk full"));

    await expect(deny()).rejects.toThrow("disk full");
  });
});

describe("opening the OAuth consent screen", () => {
  it("answers a retryable 503 that says so when the screen cannot be saved", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const client = await db.oAuthClient.create({ data: { clientName: "Example App", redirectUris: "https://claude.ai/cb" } });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER)));
    const query = new URLSearchParams({
      client_id: client.id,
      redirect_uri: "https://claude.ai/cb",
      response_type: "code",
      code_challenge: btoa(Array.from(digest, (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
      code_challenge_method: "S256",
      scope: "kitchen:read",
      state: "state_0123456789abcdef",
      resource: "https://spoonjoy.app/mcp",
    });
    vi.spyOn(db.oAuthConsentTransaction, "create").mockImplementation(lost as never);

    const result = await authorizeLoader({
      request: new Request(`https://spoonjoy.app/oauth/authorize?${query}`, { headers: { Cookie: await sessionCookie(user.id) } }),
      context: { cloudflare: { env: null } },
      params: {},
    } as never) as unknown as { data: { kind: string; message: string }; init: ResponseInit };

    expect(result.init.status).toBe(503);
    expect(new Headers(result.init.headers).get("Retry-After")).toBe("1");
    expect(result.data).toMatchObject({ kind: "error", message: D1_WRITE_UNAVAILABLE_MESSAGE, retryable: true });
  });
});
